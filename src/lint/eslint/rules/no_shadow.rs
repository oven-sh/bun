use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKinds;
use bun_lint::types::IdMap;
use bun_lint::utils::ts_scope::reference_contains_type_query;
use bun_lint::utils::ts_utils;
use smallvec::SmallVec;

/// Disallow variable declarations from shadowing variables declared in the outer scope.
pub struct NoShadow(Checker);

const NO_SHADOW: Message = Message::new(
    "noShadow",
    "'{{name}}' is already declared in the upper scope on line {{shadowedLine}} column {{shadowedColumn}}.",
);
const NO_SHADOW_GLOBAL: Message =
    Message::new("noShadowGlobal", "'{{name}}' is already a global variable.");
/// Only of typescript-eslint.
const NO_ENUM_SHADOW: Message = Message::new(
    "noEnumShadow",
    "Enum members are added to the enum scope, so references to '{{name}}' in enum member initializers resolve to this member instead of the declaration in the upper scope on line {{shadowedLine}} column {{shadowedColumn}}.",
);

/// Whose `no-shadow` it is. They differ in the default of `hoist` and in how they tell the
/// exceptions for TypeScript's syntax.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Dialect {
    Eslint,
    TypeScriptEslint,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Hoist {
    All,
    Functions,
    Never,
    Types,
    FunctionsAndTypes,
}

/// The rule, for ESLint and for typescript-eslint.
pub struct Checker {
    dialect: Dialect,
    allow: Vec<Box<[u8]>>,
    builtin_globals: bool,
    hoist: Hoist,
    ignore_on_initialization: bool,
    ignore_type_value_shadow: bool,
    ignore_function_type_parameter_name_value_shadow: bool,
}

/// ESLint's `Variable`, if it has `identifiers`.
#[derive(Copy, Clone)]
struct Variable<'a> {
    symbol: Symbol<'a>,
    scope: Scope<'a>,
    /// `defs[0]`
    definition: Declaration<'a>,
    /// The range of `identifiers[0]`.
    identifier: Span,
    /// Where it is reported: for oxlint the name alone.
    place: Span,
    /// `isValueVariable`
    is_value: bool,
    /// ESLint's `isDuplicatedClassNameVariable`: the name of a class declaration, in the scope of
    /// the class.
    is_duplicated_class_name: bool,
}

/// What has been found out about a file.
struct Known<'a> {
    /// The scopes of `declare global { }`.
    global_augmentations: SmallVec<[Scope<'a>; 1]>,
    /// [`functions_without_body`], once they are asked for.
    without_body: Option<Vec<Span>>,
    /// Whether the file uses what it imports only as a type.
    only_types: IdMap<Symbol<'a>, bool>,
    /// [`Known::is_namespace_of_types`]
    namespaces_of_types: IdMap<Symbol<'a>, bool>,
}

impl<'a> Known<'a> {
    /// For oxlint a namespace with nothing but types in it is no value.
    fn is_namespace_of_types(&mut self, symbol: Symbol<'a>) -> bool {
        symbol.file().language().is_oxlint
            && symbol
                .declaration_kinds()
                .contains(DeclarationKinds::TS_MODULE_NAME)
            && *self
                .namespaces_of_types
                .get_or_insert_with(symbol, || utils::oxlint::is_namespace_of_types(symbol))
    }
}

/// The class of `class A<A> {}`, given the type parameter. For ESLint the two are one variable of the
/// scope of the class, here the class is only in the scope around it.
fn class_declaration_with_the_name_of<'a>(
    definition: Declaration<'a>,
    name: Name<'a>,
) -> Option<Class<'a>> {
    match definition {
        Declaration::TypeParam(type_parameter) => match type_parameter.parent() {
            Node::Class(class)
                if matches!(class.owner(), Node::Stmt(_))
                    && class.name().is_some_and(|it| it.name() == name) =>
            {
                Some(class)
            }
            _ => None,
        },
        _ => None,
    }
}

impl<'a> Variable<'a> {
    fn new(symbol: Symbol<'a>, known: &mut Known<'a>) -> Option<Self> {
        let mut definition = symbol.declarations().find(|it| it.name_span().is_some())?;
        // The name of an enum member in quotes is not an identifier. oxlint goes by the symbol.
        let is_oxlint = symbol.file().language().is_oxlint;
        let mut with_identifier = symbol.declarations().find(|it| match it {
            Declaration::EnumMember(member) => {
                is_oxlint
                    || member
                        .key()
                        .is_some_and(|key| matches!(key.kind(), KeyKind::Ident(_)))
            }
            _ => it.name_span().is_some(),
        })?;
        let class = class_declaration_with_the_name_of(definition, symbol.name());
        if let Some(class) = class {
            definition = Declaration::Class(class);
            with_identifier = definition;
        }
        // typescript-estree has the `?` and the type annotation as parts of the identifier. Those
        // of a rest parameter belong to the `RestElement`.
        let identifier = match with_identifier {
            Declaration::Var(pat) | Declaration::Param(pat) => match pat.parent() {
                Node::Param(param) if !param.is_rest() => param.binding_span(),
                Node::VarDecl(declarator) => declarator.binding_span(),
                _ => pat.span(),
            },
            _ => with_identifier.name_span()?,
        };
        Some(Variable {
            symbol,
            scope: symbol.scope(),
            definition,
            identifier,
            place: match symbol.file().language().is_oxlint {
                true => with_identifier.name_span()?,
                false => identifier,
            },
            is_value: class.is_some()
                || symbol.is_value_variable() && !known.is_namespace_of_types(symbol),
            is_duplicated_class_name: class.is_some(),
        })
    }
}

/// Where the function types, the signatures and the functions without a body of the file are, in its order, without
/// those that are in another of them.
fn functions_without_body<'a>(file: &'a File<'a>) -> Vec<Span> {
    let is_one = |scope: &Scope| match scope.kind() {
        ScopeKind::FunctionType => true,
        ScopeKind::Function => matches!(scope.node(), Node::Func(func) if !func.has_body()),
        _ => false,
    };
    let mut all: Vec<Span> = file.scopes().filter(is_one).map(Scope::span).collect();
    utils::sort::sort_unstable_by_key(&mut all, |it| (it.start, u32::MAX - it.end));
    let mut end = 0;
    all.retain(|it| {
        let is_outermost = it.end > end;
        end = end.max(it.end);
        is_outermost
    });
    all
}

/// oxlint's `is_function_type_parameter_name_value_shadow`: whatever it is, it is declared in one of `all`, which are
/// [`functions_without_body`]. The name of a function is not declared in that function.
fn is_declared_in_function_without_body(variable: &Variable, all: &[Span]) -> bool {
    let at = match variable.definition {
        Declaration::Fn(func) => func
            .scope()
            .map_or(variable.place.start, |it| it.span().start),
        _ => variable.place.start,
    };
    let after = all.partition_point(|it| it.start < at);
    after
        .checked_sub(1)
        .and_then(|it| all.get(it))
        .is_some_and(|it| at < it.end)
}

/// The scope of a `declare global { }`.
fn is_scope_of_global_augmentation(scope: Scope) -> bool {
    scope.kind() == ScopeKind::TsModule
        && matches!(scope.node(), Node::Stmt(statement)
            if matches!(statement.kind(), StmtKind::Module(module)
                if matches!(module.name(), ModuleName::Global)))
}

/// ESLint's `isGlobalAugmentation`: in `declare global { }`. `all`: the scopes of these in the file.
fn is_global_augmentation<'a>(scope: Scope<'a>, all: &[Scope<'a>]) -> bool {
    match all.len() {
        0..=8 => all.iter().any(|it| it.contains(scope)),
        _ => scope.chain().any(is_scope_of_global_augmentation),
    }
}

/// The `ImportDeclaration` that is the `parent` of a definition.
fn import_of(definition: Declaration<'_>) -> Option<Import<'_>> {
    match definition {
        Declaration::ImportDefault(import) | Declaration::ImportNamespace(import) => Some(import),
        Declaration::ImportSpec(specifier) => Some(specifier.import()),
        _ => None,
    }
}

/// Whether the `node` of a definition is a function without a body: a signature, a function type,
/// an overload, an ambient or an abstract function. For oxlint that holds for its parameters and not for its name.
fn is_defined_by_function_without_body(definition: Declaration) -> bool {
    match definition {
        Declaration::Fn(func) => !func.has_body() && !func.file().language().is_oxlint,
        Declaration::Param(pat) => Node::Pat(pat)
            .enclosing_function()
            .is_some_and(|func| !func.has_body()),
        _ => false,
    }
}

/// ESLint's `unwrapExpression`: the uppermost expression that can evaluate to `e`.
fn unwrap_expression(mut e: Expr<'_>) -> Expr<'_> {
    while let Node::Expr(parent) = e.parent() {
        let evaluates_to_it = match parent.kind() {
            ExprKind::Binary { op, .. } => matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish),
            ExprKind::Cond { test, .. } => test != e,
            _ => false,
        };
        if !evaluates_to_it {
            break;
        }
        e = parent;
    }
    e
}

/// ESLint's `isFunctionNameInitializerException`, typescript-eslint's `isOnInitializer`:
/// `var a = function a() {}`, `var { A = foo || class A {} } = b`.
fn is_function_name_initializer_exception<'a>(
    variable: &Variable<'a>,
    shadowed: &Variable<'a>,
) -> bool {
    let owner = match variable.definition {
        Declaration::Fn(func) if func.kind() == FnKind::Expr => func.owner(),
        Declaration::Class(class) => class.owner(),
        _ => return false,
    };
    let (Declaration::Var(outer) | Declaration::Param(outer)) = shadowed.definition else {
        return false;
    };
    let initializer = match outer.parent() {
        Node::VarDecl(declarator) => declarator.init(),
        Node::PatProp(property) => property.default(),
        Node::PatElem(element) => element.default(),
        Node::Param(param) => param.default(),
        _ => None,
    };
    let Node::Expr(e) = owner else {
        return false;
    };
    // For oxlint it can be anywhere in the value of a variable, with no other scope between:
    // `const A = wrap(function A() {})`, `const { A } = wrap(function A() {})`.
    if e.file().language().is_oxlint && matches!(shadowed.definition, Declaration::Var(_)) {
        let of_declarator = || {
            Node::Pat(outer).ancestors().find_map(|it| match it {
                Node::VarDecl(declarator) => Some(declarator.init()),
                _ => None,
            })?
        };
        return initializer
            .or_else(of_declarator)
            .is_some_and(|it| it.outer_span().contains(e.span()))
            && variable.scope.parent() == Some(shadowed.scope);
    }
    initializer.is_some_and(|it| unwrap_expression(e) == it)
}

/// oxlint's `is_value_import_used_only_as_type`: a value can have the name of what is imported if the file only uses
/// that as a type.
fn oxlint_is_import_used_only_as_type<'a>(
    variable: &Variable<'a>,
    shadowed: &Variable<'a>,
    known: &mut IdMap<Symbol<'a>, bool>,
) -> bool {
    variable.is_value
        && import_of(shadowed.definition).is_some()
        && *known.get_or_insert_with(shadowed.symbol, || {
            let mut references = shadowed.symbol.references().peekable();
            let is_type = |it: Reference<'a>| {
                it.is_type() && !it.is_value() || reference_contains_type_query(it)
            };
            references.peek().is_some() && references.all(is_type)
        })
}

/// ESLint's `getOuterScope`.
fn get_outer_scope(scope: Scope<'_>) -> Option<Scope<'_>> {
    let upper = scope.parent()?;
    match upper.kind() {
        ScopeKind::FunctionExpressionName => upper.parent(),
        _ => Some(upper),
    }
}

/// ESLint's `isInitPatternNode`: the variable is in a callback in the initializer of what it
/// shadows, as in `const a = [].find(a => a)`.
fn is_init_pattern_node<'a>(variable: &Variable<'a>, shadowed: &Variable<'a>) -> bool {
    let (Declaration::Var(outer) | Declaration::Param(outer)) = shadowed.definition else {
        return false;
    };
    let variable_scope = variable.scope.variable_scope();
    let Node::Func(func) = variable_scope.node() else {
        return false;
    };
    if !func.has_body()
        || matches!(func.kind(), FnKind::Decl | FnKind::StaticBlock)
        || get_outer_scope(variable_scope) != Some(shadowed.scope)
    {
        return false;
    }
    let mut ancestors = Node::Func(func).ancestors();
    let Some(call) = ancestors.find(|it| matches!(it, Node::Expr(e) if e.tag() == ExprTag::Call))
    else {
        return false;
    };
    let location = call.span().end;
    let is_in_range =
        |e: Option<Expr>| e.is_some_and(|e| e.span().start <= location && location <= e.span().end);
    for node in Node::Pat(outer).ancestors() {
        let default = match node {
            Node::Pat(_) => None,
            Node::PatProp(property) => property.default(),
            Node::PatElem(element) => element.default(),
            Node::Param(param) => param.default(),
            Node::VarDecl(declarator) => {
                return is_in_range(declarator.init())
                    || matches!(declarator.parent(), Node::Stmt(declaration)
                        if matches!(declaration.parent(), Node::Stmt(parent)
                            if matches!(parent.kind(),
                                StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. }
                                    if left == declaration && is_in_range(Some(expr)))));
            }
            _ => return false,
        };
        if is_in_range(default) {
            return true;
        }
    }
    false
}

/// ESLint's `isTypeParameterOfStaticMethod`. It looks at the `static` of the parent of what has the
/// type parameters, whatever these are.
fn is_type_parameter_of_static_member(definition: Declaration) -> bool {
    let Declaration::TypeParam(type_parameter) = definition else {
        return false;
    };
    let owner = match type_parameter.parent() {
        Node::Func(func) => func.owner(),
        Node::Class(class) => class.owner(),
        _ => return false,
    };
    match owner {
        Node::Member(member) => !member.is_signature() && member.is_static(),
        Node::Expr(e) => {
            matches!(e.parent(), Node::Member(member) if member.init() == Some(e) && member.is_static())
        }
        _ => false,
    }
}

/// typescript-eslint's `isGenericOfStaticMethod`.
fn is_generic_of_static_method(definition: Declaration) -> bool {
    matches!(definition, Declaration::TypeParam(type_parameter)
        if matches!(type_parameter.parent(), Node::Func(func)
            if matches!(func.owner(), Node::Member(member)
                if !member.is_signature()
                    && member.is_static()
                    && !member.flags().contains(Flags::ABSTRACT))))
}

/// typescript-eslint's `isGenericOfClass`.
fn is_generic_of_class(definition: Declaration) -> bool {
    matches!(definition, Declaration::TypeParam(type_parameter)
        if matches!(type_parameter.parent(), Node::Class(_)))
}

/// The name of the innermost namespace or `declare module` that the name of `definition` is in, or
/// is the name of.
fn enclosing_module_name(definition: Declaration<'_>) -> Option<Name<'_>> {
    let start = match definition {
        Declaration::Var(pat) | Declaration::Param(pat) => Node::Pat(pat),
        _ => definition.node()?,
    };
    let module = std::iter::once(start)
        .chain(start.ancestors())
        .find_map(|it| match it {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Module(module) => Some(module),
                _ => None,
            },
            _ => None,
        })?;
    match module.name() {
        // `namespace A.B` has a `TSQualifiedName`.
        ModuleName::Ident(_) if module.nested().is_some() => None,
        ModuleName::Ident(name) | ModuleName::String(name) => Some(name.name()),
        ModuleName::Global => None,
    }
}

impl Checker {
    pub fn new(options: &Options, dialect: Dialect) -> Self {
        let object = options.object(0);
        Checker {
            dialect,
            allow: (object.strings("allow").into_iter())
                .map(|it| it.as_bytes().into())
                .collect(),
            builtin_globals: object.bool_or("builtinGlobals", false),
            hoist: match (object.str("hoist"), dialect) {
                (Some("all"), _) => Hoist::All,
                (Some("functions"), _) => Hoist::Functions,
                (Some("never"), _) => Hoist::Never,
                (Some("types"), _) => Hoist::Types,
                (Some("functions-and-types"), _) => Hoist::FunctionsAndTypes,
                (_, Dialect::Eslint) => Hoist::Functions,
                (_, Dialect::TypeScriptEslint) => Hoist::FunctionsAndTypes,
            },
            ignore_on_initialization: object.bool_or("ignoreOnInitialization", false),
            ignore_type_value_shadow: object.bool_or("ignoreTypeValueShadow", true),
            ignore_function_type_parameter_name_value_shadow: object
                .bool_or("ignoreFunctionTypeParameterNameValueShadow", true),
        }
    }

    /// ESLint's `isDeclareInDTSFile`.
    fn is_declare_in_dts_file(&self, file: &File, variable: &Variable) -> bool {
        let path = file.path();
        let is_definition_file = match self.dialect {
            Dialect::Eslint => {
                path.ends_with(b".d.ts") || path.ends_with(b".d.cts") || path.ends_with(b".d.mts")
            }
            Dialect::TypeScriptEslint => ts_utils::is_definition_file(path),
        };
        // oxlint's rule looks at all that the first declaration is in.
        let is_declared = |it: Node| match it {
            Node::Stmt(it) => it.flags().contains(Flags::AMBIENT),
            Node::Func(func) => func.kind() == FnKind::Decl && !func.has_body(),
            _ => false,
        };
        if is_definition_file
            && file.language().is_oxlint
            && let Some(first) = variable
                .symbol
                .declarations()
                .next()
                .and_then(Declaration::node)
            && first.ancestors().any(is_declared)
        {
            return true;
        }
        is_definition_file
            && variable.symbol.declarations().any(|definition| {
                let declaration = match definition {
                    Declaration::Var(_) => definition.parent(),
                    Declaration::Class(class) => Some(class.owner()),
                    Declaration::Enum(it) => Some(Node::Stmt(it.stmt())),
                    Declaration::Module(it) => Some(Node::Stmt(it.outermost().stmt())),
                    _ => None,
                };
                matches!(declaration, Some(Node::Stmt(it)) if it.flags().contains(Flags::AMBIENT))
            })
    }

    /// ESLint's `isInTdz`: the variable comes before what it shadows, and that is not hoisted.
    fn is_in_tdz(&self, variable: &Variable, shadowed: &Variable) -> bool {
        if variable.identifier.end >= shadowed.identifier.start {
            return false;
        }
        // The `node` of the definition of a parameter is the function.
        let function = match shadowed.definition {
            Declaration::Fn(func) => Some(func),
            Declaration::Param(pat) => Node::Pat(pat).enclosing_function(),
            _ => None,
        };
        let is_function =
            function.is_some_and(|func| func.kind() == FnKind::Decl && func.has_body());
        let is_type = matches!(
            shadowed.definition,
            Declaration::Interface(_) | Declaration::TypeAlias(_)
        );
        match self.hoist {
            Hoist::All => false,
            Hoist::Functions => !is_function,
            Hoist::Types => !is_type,
            Hoist::FunctionsAndTypes => !is_function && !is_type,
            Hoist::Never => true,
        }
    }

    /// ESLint's `isTypeValueShadow`. `shadowed` is `None` for a global variable.
    fn is_type_value_shadow(&self, variable: &Variable, shadowed: Option<&Variable>) -> bool {
        if !self.ignore_type_value_shadow {
            return false;
        }
        let is_shadowed_value = shadowed.is_none_or(|shadowed| {
            let is_type_import = match self.dialect {
                // One `type` specifier makes types of all the specifiers of the declaration.
                Dialect::Eslint => import_of(shadowed.definition).is_some_and(|import| {
                    import.is_type_only() || import.named().iter().any(ImportSpec::is_type_only)
                }),
                Dialect::TypeScriptEslint => ts_utils::is_type_import(shadowed.definition),
            };
            !is_type_import && shadowed.is_value
        });
        variable.is_value != is_shadowed_value
    }

    /// ESLint's `isFunctionTypeParameterNameValueShadow`.
    fn is_function_type_parameter_name_value_shadow(
        &self,
        variable: &Variable,
        shadowed: Option<&Variable>,
        is_global_value: bool,
    ) -> bool {
        if !self.ignore_function_type_parameter_name_value_shadow {
            return false;
        }
        let mut definitions = variable.symbol.declarations();
        match self.dialect {
            Dialect::Eslint => definitions.any(is_defined_by_function_without_body),
            Dialect::TypeScriptEslint => {
                shadowed.map_or(is_global_value, |shadowed| shadowed.is_value)
                    && definitions.all(is_defined_by_function_without_body)
            }
        }
    }

    /// ESLint's `isGenericOfAStaticMethodShadow`.
    fn is_generic_of_a_static_method_shadow(
        &self,
        variable: &Variable,
        shadowed: Option<&Variable>,
    ) -> bool {
        match self.dialect {
            Dialect::Eslint => is_type_parameter_of_static_member(variable.definition),
            Dialect::TypeScriptEslint => {
                is_generic_of_static_method(variable.definition)
                    && shadowed.is_some_and(|shadowed| is_generic_of_class(shadowed.definition))
            }
        }
    }

    /// ESLint's `isExternalDeclarationMerging`: `import type { A } from "m"` and
    /// `declare module "m" { interface A {} }`.
    fn is_external_declaration_merging<'a>(
        &self,
        variable: &Variable<'a>,
        shadowed: &Variable<'a>,
    ) -> bool {
        let Some(import) = import_of(shadowed.definition) else {
            return false;
        };
        match self.dialect {
            Dialect::Eslint => {
                let name = shadowed.symbol.name();
                (import.is_type_only()
                    || (import.named().iter())
                        .any(|it| it.is_type_only() && it.local().name() == name))
                    && enclosing_module_name(variable.definition) == Some(import.spec())
            }
            Dialect::TypeScriptEslint => {
                ts_utils::is_type_import(shadowed.definition)
                    && matches!(
                        variable.definition,
                        Declaration::Interface(_) | Declaration::TypeAlias(_)
                    )
                    && matches!(variable.scope.node(), Node::Stmt(statement)
                        if matches!(statement.kind(), StmtKind::Module(module)
                            if matches!(module.name(), ModuleName::String(name)
                                if name.name() == import.spec())))
            }
        }
    }

    /// `shadowed`: what the name of `symbol` means around its scope. `None`: with `builtinGlobals`,
    /// a global variable, which is a value or only a type of a library of TypeScript.
    fn check_variable<'a, R: Rule>(
        &self,
        cx: &Cx<'a, R>,
        symbol: Symbol<'a>,
        shadowed: Option<Symbol<'a>>,
        is_global_value: bool,
        known: &mut Known<'a>,
    ) {
        let name = symbol.name();
        if name.is("this") || self.allow.iter().any(|it| **it == *name.bytes()) {
            return;
        }
        let Some(variable) = Variable::new(symbol, known) else {
            return;
        };
        let shadowed = match shadowed {
            Some(shadowed) => match Variable::new(shadowed, known) {
                Some(shadowed) => Some(shadowed),
                // `arguments` or an enum member in quotes, which hide what is further out.
                None => return,
            },
            None => None,
        };
        let file = cx.file();
        if is_global_augmentation(variable.scope, &known.global_augmentations)
            || variable.is_duplicated_class_name
            || self.is_declare_in_dts_file(file, &variable)
            || self.is_type_value_shadow(&variable, shadowed.as_ref())
            || self.is_function_type_parameter_name_value_shadow(
                &variable,
                shadowed.as_ref(),
                is_global_value,
            )
            || file.language().is_oxlint
                && self.ignore_function_type_parameter_name_value_shadow
                && is_declared_in_function_without_body(
                    &variable,
                    known
                        .without_body
                        .get_or_insert_with(|| functions_without_body(file)),
                )
            || self.is_generic_of_a_static_method_shadow(&variable, shadowed.as_ref())
        {
            return;
        }
        let Some(shadowed) = shadowed else {
            cx.report(variable.place, NO_SHADOW_GLOBAL)
                .data("name", name);
            return;
        };
        if is_function_name_initializer_exception(&variable, &shadowed)
            || (self.ignore_on_initialization && is_init_pattern_node(&variable, &shadowed))
            || self.is_in_tdz(&variable, &shadowed)
            || self.is_external_declaration_merging(&variable, &shadowed)
            || file.language().is_oxlint
                && oxlint_is_import_used_only_as_type(&variable, &shadowed, &mut known.only_types)
        {
            return;
        }
        let is_enum = self.dialect == Dialect::TypeScriptEslint
            && shadowed
                .symbol
                .declaration_kinds()
                .contains(DeclarationKinds::TS_ENUM_NAME);
        let position = file.position(shadowed.identifier.start);
        cx.report(
            variable.place,
            if is_enum { NO_ENUM_SHADOW } else { NO_SHADOW },
        )
        .data("name", name)
        .data("shadowedLine", position.line)
        .data("shadowedColumn", position.column + 1)
        .labels_with(|labels| {
            // The name without its type.
            let start = shadowed.identifier.start;
            labels.push(
                Span::new(start, start + name.bytes().len() as u32),
                "shadowed declaration is here",
            );
        });
    }

    /// Reports every variable of the file that shadows another. What is declared in the global
    /// scope shadows nothing.
    pub fn check<'a, R: Rule>(&self, cx: &Cx<'a, R>) {
        let file = cx.file();
        let mut global_augmentations: SmallVec<[Scope<'a>; 1]> = SmallVec::new();
        if file.has_stmts([StmtTag::Module]) {
            global_augmentations.extend(
                file.scopes()
                    .filter(|it| is_scope_of_global_augmentation(*it)),
            );
        }
        let mut known = Known {
            global_augmentations,
            without_body: None,
            only_types: IdMap::default(),
            namespaces_of_types: IdMap::default(),
        };
        // By the last bits of the number of a name: the outermost of the scopes around the one that is looked at that declare
        // such a name. The scopes come in the order they start, so what is not around one is around none that follows. A
        // name without such a scope shadows nothing that the file declares.
        let places = (file.symbol_key_limit() * 4).next_power_of_two();
        let place_of = |symbol: Symbol<'a>| symbol.name().atom().0 as usize & (places - 1);
        let mut declared_in: SmallVec<[Option<Scope<'a>>; 256]> = SmallVec::from_elem(None, places);
        for scope in file.scopes() {
            let upper = scope.parent();
            for symbol in scope.symbols() {
                let Some(outermost) = declared_in.get_mut(place_of(symbol)) else {
                    continue;
                };
                let may_shadow = match *outermost {
                    Some(it) if it.contains(scope) => it != scope,
                    _ => {
                        *outermost = Some(scope);
                        false
                    }
                };
                let Some(upper) = upper.filter(|_| !symbol.is_implicit_arguments()) else {
                    continue;
                };
                let name = symbol.name();
                let shadowed = if may_shadow {
                    upper.resolve_name(name)
                } else {
                    None
                };
                let global = match shadowed {
                    None if self.builtin_globals => file.global(name.bytes()),
                    _ => None,
                };
                if shadowed.is_some() || global.is_some() {
                    let is_global_value = global.is_none_or(|it| it.is_value);
                    self.check_variable(cx, symbol, shadowed, is_global_value, &mut known);
                }
            }
        }
    }
}

impl Rule for NoShadow {
    const META: Meta = Meta::eslint("no-shadow", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        NoShadow(Checker::new(options, Dialect::Eslint))
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.0.check(cx);
    }
}
