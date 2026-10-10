use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKind;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::ts_scope::reference_contains_type_query;

/// Disallow the use of variables before they are defined.
pub struct NoUseBeforeDefine {
    config: Config,
}

const USED_BEFORE_DEFINED: Message =
    Message::new("usedBeforeDefined", "'{{name}}' was used before it was defined.");

/// The options, which are those of the rule of typescript-eslint as well.
pub struct Config {
    pub functions: bool,
    pub classes: bool,
    pub variables: bool,
    pub allow_named_exports: bool,
    pub enums: bool,
    pub typedefs: bool,
    pub ignore_type_references: bool,
}

impl Config {
    /// ESLint's `parseOptions`.
    pub fn new(options: &Options) -> Config {
        let object = options.object(0);
        Config {
            functions: object.bool_or("functions", options.str(0) != Some("nofunc")),
            classes: object.bool_or("classes", true),
            variables: object.bool_or("variables", true),
            allow_named_exports: object.bool_or("allowNamedExports", false),
            enums: object.bool_or("enums", true),
            typedefs: object.bool_or("typedefs", true),
            ignore_type_references: object.bool_or("ignoreTypeReferences", true),
        }
    }
}

/// ESLint's `isInRange`.
fn is_in_range(range: Span, location: u32) -> bool {
    range.start <= location && location <= range.end
}

/// Where ESLint's `definition.name` ends. For typescript-eslint, a type annotation is part of it.
pub fn definition_name_end(definition: Declaration) -> Option<u32> {
    match definition {
        Declaration::Var(pat) | Declaration::Param(pat) => Some(utils::estree_span(pat.into()).end),
        _ => definition.name_span().map(|it| it.end),
    }
}

/// `identifier.parent.type === "ExportSpecifier" && identifier.parent.local === identifier`
pub fn is_named_export(reference: Reference) -> bool {
    matches!(reference.node(), Node::ExportSpec(_))
}

/// What is evaluated while a variable is initialized, by the loop in ESLint's
/// `isEvaluatedDuringInitialization` and in typescript-eslint's `isInInitializer`: the initializer
/// of the declaration, what its `for`-`in` or `for`-`of` iterates over, and the defaults of the
/// patterns around the name.
///
/// That loop goes up from the name, once for each reference. Here it is known where it ends, and from the reference
/// in whose initializer that is: if the name is in the same declarator, element, property, parameter or assignment,
/// the loop has passed it.
#[derive(Default)]
pub struct Initializers<'a> {
    /// What the loop does not leave, from a node.
    ends: AncestorMemo<'a, Node<'a>>,
    /// The nearest node in whose initializer a node is.
    owners: AncestorMemo<'a, Node<'a>>,
}

/// The declaration of a variable, for [`Initializers::has`].
#[derive(Copy, Clone)]
pub struct Declared {
    /// Where the name starts.
    name: u32,
    /// What the loop does not leave.
    within: Span,
    /// What the `for`-`in` or `for`-`of` of the declaration iterates over.
    iterated: Option<Span>,
}

/// Whether `child` is what `parent` initializes a variable with.
fn is_initializer_of<'a>(child: Node<'a>, parent: Node<'a>) -> bool {
    let Node::Expr(child) = child else {
        return false;
    };
    match parent {
        // Not the parameter of a `catch`.
        Node::VarDecl(declarator) => {
            declarator.init() == Some(child)
                && matches!(declarator.parent(), Node::Stmt(it) if it.tag() == StmtTag::Var)
        }
        Node::PatElem(element) => element.default() == Some(child),
        Node::PatProp(prop) => prop.default() == Some(child),
        Node::Param(param) => param.default() == Some(child),
        Node::Expr(e) => {
            matches!(e.kind(), ExprKind::Assign { value, .. } if value == child) && utils::is_assignment_target(e)
        }
        _ => false,
    }
}

impl<'a> Initializers<'a> {
    /// `None` for what has no initializer.
    pub fn declared(&mut self, definition: Declaration<'a>) -> Option<Declared> {
        let name = match definition {
            Declaration::Var(pat) | Declaration::Param(pat) => Node::Pat(pat),
            // One of a function type, a mapped type or an `infer` can be in an initializer.
            Declaration::TypeParam(param) => Node::TypeParam(param),
            _ => return None,
        };
        let end = self.ends.find(name, |child, parent| match parent {
            Node::VarDecl(_) => Some(parent),
            // A signature or a function type does not end the search.
            Node::Func(func) if func.has_body() && func.kind() != FnKind::StaticBlock => Some(child),
            // Around a statement is nothing but functions, classes, namespaces and the file.
            Node::Class(_) | Node::Stmt(_) => Some(child),
            _ => None,
        })?;
        let mut iterated = None;
        if let Node::VarDecl(declarator) = end
            && let Node::Stmt(declaration) = declarator.parent()
            && declaration.tag() == StmtTag::Var
            && let Node::Stmt(parent) = declaration.parent()
            && let StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } = parent.kind()
        {
            iterated = Some(expr.span());
        }
        Some(Declared {
            name: name.span().start,
            within: end.span(),
            iterated,
        })
    }

    /// Whether `reference` is in an initializer of the variable.
    pub fn has(&mut self, declared: Declared, reference: Reference<'a>) -> bool {
        let location = reference.span().end;
        if declared.iterated.is_some_and(|it| is_in_range(it, location)) {
            return true;
        }
        if !is_in_range(declared.within, location) {
            return false;
        }
        let mut at = reference.node();
        while let Some(owner) =
            (self.owners).find(at, |child, parent| is_initializer_of(child, parent).then_some(parent))
        {
            let span = owner.span();
            if !declared.within.contains(span) {
                return false;
            }
            if span.contains_offset(declared.name) {
                return true;
            }
            at = owner;
        }
        false
    }
}

/// ESLint's `isClassRefInClassDecorator`.
pub fn is_class_ref_in_class_decorator(definition: Declaration, identifier: Span) -> bool {
    matches!(definition, Declaration::Class(class)
        if class.modifiers().iter().any(|it| it.decorator().is_some() && it.span().contains(identifier)))
}

/// ESLint's `isInClassStaticInitializerRange`.
fn is_in_class_static_initializer_range(class: Class, location: u32) -> bool {
    // `location` is the end of a name.
    class.members().around(location.saturating_sub(1)).is_some_and(|member| match member.kind() {
        MemberKind::StaticBlock => is_in_range(member.span(), location),
        MemberKind::Property => {
            member.is_static()
                && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
                && member.init().is_some_and(|value| is_in_range(value.span(), location))
        }
        _ => false,
    })
}

/// ESLint's `isClassStaticInitializerScope`.
fn is_class_static_initializer_scope(scope: Scope) -> bool {
    match scope.kind() {
        ScopeKind::ClassStaticBlock => true,
        ScopeKind::ClassFieldInitializer => {
            matches!(scope.node().parent(), Node::Member(member) if member.is_static())
        }
        _ => false,
    }
}

/// ESLint's `isFromSeparateExecutionContext`.
fn is_from_separate_execution_context<'a>(variable: Symbol<'a>, reference: Reference<'a>) -> bool {
    let context = variable.scope().variable_scope();
    let mut scope = reference.scope().variable_scope();
    while scope != context {
        if !is_class_static_initializer_scope(scope) {
            return true;
        }
        let Some(upper) = scope.parent() else {
            return true;
        };
        scope = upper.variable_scope();
    }
    false
}

/// ESLint's `identifier.parent.type`, as far as the rule tells types apart.
#[derive(PartialEq)]
enum Parent {
    TypeReference,
    QualifiedName,
    Other,
}

/// Whether `ty` is an element of `implements`, or of the `extends` of an interface: a
/// `TSClassImplements` or a `TSInterfaceHeritage`, not a `TSTypeReference`.
fn is_heritage(ty: TypeNode) -> bool {
    match ty.parent() {
        Node::Class(class) => class.implements().around(ty.span().start) == Some(ty),
        Node::Stmt(parent) => {
            matches!(parent.kind(), StmtKind::Interface(it) if it.extends().around(ty.span().start) == Some(ty))
        }
        _ => false,
    }
}

fn parent_of_identifier(reference: Reference, is_in_type_query: bool) -> Parent {
    let of_name = |name: EntityName, alone: Parent| match name.len() {
        0 | 1 => alone,
        _ => Parent::QualifiedName,
    };
    match reference.node() {
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { name, .. } if !is_heritage(ty) => of_name(name, Parent::TypeReference),
            _ => Parent::Other,
        },
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::ImportEquals(import) => match import.target() {
                ImportEqualsTarget::Entity(name) => of_name(name, Parent::Other),
                ImportEqualsTarget::Require(_) => Parent::Other,
            },
            _ => Parent::Other,
        },
        // `typeof a.b`
        Node::Expr(e) if is_in_type_query && matches!(e.parent(), Node::Expr(_)) => Parent::QualifiedName,
        _ => Parent::Other,
    }
}

impl NoUseBeforeDefine {
    fn check<'a>(&self, variable: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        let config = &self.config;
        let references = variable.references();
        if references.len() == 0 {
            return;
        }
        let Some(definition) = variable.declarations().next() else {
            return;
        };
        let (Some(kind), Some(definition_end)) = (definition.kind(), definition_name_end(definition)) else {
            return;
        };
        if !config.functions && kind == DeclarationKind::FunctionName
            || !config.enums && kind == DeclarationKind::TsEnumName
            || !config.typedefs && kind == DeclarationKind::Type
        {
            return;
        }
        let declared = cx.state.declared(definition);
        let is_in_initializer = |reference: Reference<'a>, initializers: &mut Initializers<'a>| match definition {
            // The binding of a class is initialized before its static initializers run.
            Declaration::Class(class) => {
                let location = reference.span().end;
                is_in_range(class.estree_span(), location)
                    && !is_in_class_static_initializer_range(class, location)
            }
            _ => declared.is_some_and(|it| initializers.has(it, reference)),
        };
        for reference in references {
            // What JSX makes of `React` is a reference whose identifier is the declaration.
            if reference.is_init() || reference.is_jsx_pragma() {
                continue;
            }
            let identifier = reference.span();
            let is_before = identifier.end < definition_end;
            if !is_before && !is_in_initializer(reference, &mut cx.state) {
                continue;
            }
            if config.allow_named_exports && is_named_export(reference) {
                continue;
            }
            let is_separate = is_from_separate_execution_context(variable, reference);
            // In the same execution context there is the temporal dead zone.
            if is_separate
                && (!config.variables && kind == DeclarationKind::Variable
                    || !config.classes && kind == DeclarationKind::ClassName)
            {
                continue;
            }
            let is_in_type_query = reference_contains_type_query(reference);
            let parent = parent_of_identifier(reference, is_in_type_query);
            if config.ignore_type_references && (is_in_type_query || parent == Parent::TypeReference) {
                continue;
            }
            if parent != Parent::QualifiedName && is_class_ref_in_class_decorator(definition, identifier) {
                continue;
            }
            if is_before || !is_separate && parent != Parent::TypeReference {
                cx.report(identifier, USED_BEFORE_DEFINED).data("name", reference.name());
            }
        }
    }
}

impl Rule for NoUseBeforeDefine {
    const META: Meta = Meta::eslint("no-use-before-define", Kind::Problem);
    const ON: On = On::new().symbols();
    type State<'a> = Initializers<'a>;

    fn new(options: &Options) -> Self {
        NoUseBeforeDefine {
            config: Config::new(options),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Initializers<'a>> {
        Some(Initializers::default())
    }

    fn symbol<'a>(&self, variable: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        self.check(variable, cx);
    }
}
