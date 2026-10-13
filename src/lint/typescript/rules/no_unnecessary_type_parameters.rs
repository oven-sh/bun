use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::tsutils::is_type_reference;
use bun_lint::types::{IdMap, IdSet, Signature, SyntaxKind, TsNode, Type, TypeFlags, TypeStructure};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::rc::Rc;

/// Disallow type parameters that aren't used multiple times.
pub struct NoUnnecessaryTypeParameters;

const REPLACE_USAGES_WITH_CONSTRAINT: Message = Message::new(
    "replaceUsagesWithConstraint",
    "Replace all usages of type parameter with its constraint.",
);
const SOLE: Message =
    Message::new("sole", "Type parameter {{name}} is {{uses}} in the {{descriptor}} signature.");

/// ESLint has a `TSClassImplements` or a `TSInterfaceHeritage` for it, not a `TSTypeReference`.
fn is_heritage(ty: TypeNode) -> bool {
    match ty.parent() {
        Node::Class(class) => class.extends_args().around(ty.span().start) != Some(ty),
        Node::Stmt(statement) => statement.tag() == StmtTag::Interface,
        _ => false,
    }
}

/// Whether the reference is all of a type argument, of anything but `Array` and `ReadonlyArray`,
/// which are left to the types.
fn is_type_argument(reference: Reference) -> bool {
    let Node::Type(type_reference) = reference.node() else {
        return false;
    };
    if !matches!(type_reference.kind(), TypeKind::Ref { name, .. } if name.len() == 1) || is_heritage(type_reference) {
        return false;
    }
    match type_reference.parent() {
        Node::Type(outer) => match outer.kind() {
            TypeKind::Ref { name, .. } => !(name.is("Array") || name.is("ReadonlyArray")) || is_heritage(outer),
            TypeKind::Heritage { .. } | TypeKind::Typeof { .. } | TypeKind::Import { .. } => true,
            _ => false,
        },
        Node::Expr(outer) => matches!(
            outer.kind(),
            ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Instantiation { .. }
                | ExprKind::Jsx(_)
        ),
        // `extends Base<T>`
        Node::Class(_) => true,
        _ => false,
    }
}

/// What tsgolint takes for a reference: an identifier whose parent is a type node. Not the `T` of `T.Member`, whose
/// parent is a qualified name.
fn is_identifier_of_type_node(reference: Reference) -> bool {
    match reference.node() {
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { name, .. } => name.len() == 1,
            TypeKind::Predicate { .. } => true,
            _ => false,
        },
        // `typeof T`, where a value of the name is one symbol with the type parameter.
        Node::Expr(expr) => {
            matches!(expr.parent(), Node::Type(ty) if matches!(ty.kind(), TypeKind::Typeof { .. }))
        }
        _ => false,
    }
}

fn is_type_parameter_repeated_in_ast<'a>(
    node: TypeParam<'a>,
    references: impl Iterator<Item = Reference<'a>>,
    start_of_body: u32,
    is_oxlint: bool,
    found_in_jsdoc: u32,
) -> bool {
    let definition = node.span();
    let mut total = found_in_jsdoc;
    for reference in references {
        let identifier = reference.span();
        // What is inside the definition of the type parameter does not count, nor what is outside
        // the signature, nor a value of the same name.
        if (identifier.start < definition.end && identifier.end > definition.start)
            || identifier.start > start_of_body
        {
            continue;
        }
        let is_reference = match is_oxlint {
            true => is_identifier_of_type_node(reference),
            false => reference.is_type(),
        };
        if !is_reference {
            continue;
        }
        // tsgolint leaves a type argument to the types: in `Missing<T> & { a: 1 }`, which is `any`, there is no `T`.
        if !is_oxlint && is_type_argument(reference) {
            return true;
        }
        total += 1;
        if total >= 2 {
            return true;
        }
    }
    false
}

/// The name of a type parameter in the type of a JSDoc tag. tsgo reads these types in a TypeScript file too, and tsgolint
/// walks with `ForEachChildAndJSDoc`: they are references.
#[derive(Copy, Clone)]
struct JsdocReference {
    identifier: Span,
    is_weak_precedence_type_parent: bool,
}

type JsdocReferences = SmallVec<[JsdocReference; 2]>;

fn collect_jsdoc_references<'a>(
    file: &'a File<'a>,
    comment: Token<'a>,
    name: &[u8],
    references: &mut JsdocReferences,
) {
    if comment.kind() != TokenKind::Block || !strings::contains(comment.comment_value(), name) {
        return;
    }
    let Some(jsdoc) = file.jsdoc().at(comment.start()) else {
        return;
    };
    let is_identifier_part = |byte: u8| !byte.is_ascii() || bun_core::lexer::is_identifier_part(u32::from(byte));
    for tag in jsdoc.tags() {
        // The tags whose type tsgo reads. Not `@see`, `@enum`, a `@property` without a `@typedef`, or a tag it does not know.
        let has_type_expression = matches!(
            tag.kind.parsed(),
            b"param"
                | b"arg"
                | b"argument"
                | b"returns"
                | b"return"
                | b"type"
                | b"throws"
                | b"exception"
                | b"this"
                | b"satisfies"
                | b"typedef"
                | b"template"
                | b"implements"
                | b"extends"
                | b"augments"
        );
        let (Some(type_part), _) = tag.type_comment() else {
            continue;
        };
        let type_text = type_part.raw();
        // It finds none in a type that goes over a line, and a name in quotes is no type.
        if !has_type_expression || strings::index_of_any(type_text, b"\n\r\"'`").is_some() {
            continue;
        }
        let mut from = 0;
        while let Some(found) = type_text.get(from..).and_then(|rest| strings::index_of(rest, name)) {
            let (start, end) = (from + found, from + found + name.len());
            from = end;
            let (Some(before), Some(after)) = (type_text.get(..start), type_text.get(end..)) else {
                break;
            };
            let (previous, next) = (before.trim_ascii_end(), after.trim_ascii_start());
            // Not a part of a longer name, of `a.T`, `T.a` or `typeof T`, and not the name of a property or of a parameter.
            if before.last().is_some_and(|&byte| is_identifier_part(byte))
                || after.first().is_some_and(|&byte| is_identifier_part(byte))
                || (previous.ends_with(b".") && !previous.ends_with(b"..."))
                || previous.ends_with(b"typeof")
                || next.starts_with(b".")
                || next.starts_with(b":")
                || next.starts_with(b"?:")
            {
                continue;
            }
            let is_weak_precedence_type_parent = matches!(next.first(), Some(b'[' | b'|' | b'&'))
                || matches!(previous.last(), Some(b'|' | b'&'))
                || previous.ends_with(b"keyof")
                || previous.ends_with(b"readonly");
            let start_of_type = type_part.span.start;
            references.push(JsdocReference {
                identifier: Span::new(start_of_type + start as u32, start_of_type + end as u32),
                is_weak_precedence_type_parent,
            });
        }
    }
}

/// The JSDoc comments that tsgo attaches to what starts at `start`: TypeScript's `getJSDocCommentRanges`. Those behind
/// the first line break after the token before, and for a parameter, a function expression and an arrow function also
/// those on the line of that token.
fn collect_jsdoc_references_before<'a>(
    file: &'a File<'a>,
    start: u32,
    name: &[u8],
    takes_comments_of_the_line: bool,
    references: &mut JsdocReferences,
) {
    let mut is_collecting = takes_comments_of_the_line;
    let mut end_of_previous = None;
    for comment in file.comments_before(Span::empty(start)) {
        let after = end_of_previous.unwrap_or_else(|| {
            let before = file.text().get(..comment.start() as usize).unwrap_or_default();
            before.trim_ascii_end().len() as u32
        });
        is_collecting = is_collecting
            || after == 0
            || strings::contains_js_line_break(file.slice(Span::new(after, comment.start())));
        if is_collecting {
            collect_jsdoc_references(file, comment, name, references);
        }
        end_of_previous = Some(comment.end());
    }
}

/// Where tsgo's node of a function or of a class starts: with `export` and the decorators.
fn start_of_declaration(owner: Node<'_>, span: Span) -> u32 {
    match owner {
        Node::Stmt(statement) => statement.span().start.min(span.start),
        _ => span.start,
    }
}

/// What tsgolint finds before the body: in the JSDoc comments of the node and in those of its parameters.
fn collect_jsdoc_references_of_signature(node: Node<'_>, name: &[u8], references: &mut JsdocReferences) {
    let file = node.file();
    match node {
        Node::Func(func) => {
            // tsgo attaches no JSDoc comment to a function type.
            if !matches!(func.owner(), Node::Type(_)) {
                let start = start_of_declaration(func.owner(), func.span());
                let is_expression = matches!(func.kind(), FnKind::Expr | FnKind::Arrow);
                collect_jsdoc_references_before(file, start, name, is_expression, references);
            }
            for parameter in func.params() {
                collect_jsdoc_references_before(file, parameter.span().start, name, true, references);
            }
        }
        Node::Class(class) => {
            let start = start_of_declaration(class.owner(), class.span());
            collect_jsdoc_references_before(file, start, name, false, references);
        }
        _ => {}
    }
}

/// Whether something inside `scope` and around `at` declares a type of the name: there a name in a JSDoc comment is not
/// the type parameter.
fn is_shadowed<'a>(scope: Scope<'a>, name: Name<'a>, at: u32) -> bool {
    scope.children().any(|child| {
        let node = child.node();
        let start = match node {
            Node::Func(func) => start_of_declaration(func.owner(), func.span()),
            Node::Class(class) => start_of_declaration(class.owner(), class.span()),
            _ => node.span().start,
        };
        start <= at
            && at < node.span().end
            && (child.get_name(name).is_some_and(|symbol| symbol.is_type_variable()) || is_shadowed(child, name, at))
    })
}

/// By the declaration of the type parameter.
type Counts<'a> = FxHashMap<TsNode<'a>, u32>;

#[derive(Default)]
pub struct State<'a> {
    /// What has been counted in the type of a function.
    counts_by_type: IdMap<Type<'a>, Rc<Counts<'a>>>,
    without_type_parameters: TypesWithoutTypeParameters<'a>,
}

/// The types that have been gone through to the end, and no type parameter was found. To go through one again counts
/// nothing, whatever has been visited before, and many functions mention the same large types.
type TypesWithoutTypeParameters<'a> = IdSet<Type<'a>>;

/// Upstream's `collectTypeParameterUsageCounts`: how often each type parameter appears in a type.
struct UsageCounter<'a, 'c> {
    found_identifier_usages: &'c mut Counts<'a>,
    /// The type parameters are those of a class, or of one of its methods.
    from_class: bool,
    /// Upstream has the lists of properties, of which each type has its own.
    visited_symbol_lists: IdSet<Type<'a>>,
    type_usages: IdMap<Type<'a>, u32>,
    visited_constraints: FxHashSet<TsNode<'a>>,
    visited_default: bool,
    without_type_parameters: &'c mut TypesWithoutTypeParameters<'a>,
    /// How many type parameters have been found, and how often something was not gone through.
    found_or_left_out: u32,
}

/// Upstream's `assumeMultipleUses`: what one appearance of a type parameter counts as.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Uses {
    One,
    Multiple,
}

/// Upstream's `isReturnType`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    Return,
    Elsewhere,
}

fn get_declared_constraint_type(type_parameter: Type<'_>) -> Option<Type<'_>> {
    let mut declarations = type_parameter.get_symbol()?.declarations();
    let declaration = declarations.find(|it| it.kind() == SyntaxKind::TypeParameter)?;
    Some(declaration.constraint()?.get_type_at_location())
}

impl<'a> UsageCounter<'a, '_> {
    fn visit_type(&mut self, ty: Type<'a>, uses: Uses, place: Place) {
        // The same type more than 3 ** 2 times is likely a recursive type, like
        // `type T = { [P in keyof T]: T }`. If not, what it refers to has been counted often enough.
        if self.without_type_parameters.contains(ty) {
            return;
        }
        let usages = self.type_usages.get_or_insert_with(ty, || 0);
        *usages += 1;
        let usages = *usages;
        if usages > 9 || !bun_core::StackCheck::init().is_safe_to_recurse() {
            self.found_or_left_out += 1;
            return;
        }
        let before = self.found_or_left_out;
        self.visit_parts(ty, uses, place);
        if self.found_or_left_out == before {
            self.without_type_parameters.insert(ty);
        }
    }

    fn visit_types_list(&mut self, types: impl IntoIterator<Item = Type<'a>>, uses: Uses) {
        for ty in types {
            self.visit_type(ty, uses, Place::Elsewhere);
        }
    }

    fn visit_parts(&mut self, ty: Type<'a>, uses: Uses, place: Place) {
        let flags = ty.flags();
        if flags.contains(TypeFlags::TYPE_PARAMETER) {
            self.visit_type_parameter(ty, uses);
        } else if !ty.alias_type_arguments().is_empty() {
            // The definition of the type alias is not looked into, so how often it uses them is
            // not known.
            self.visit_types_list(ty.alias_type_arguments(), Uses::Multiple);
        } else if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
            self.visit_types_list(ty.types(), uses);
        } else if is_type_reference(ty) {
            // A readonly array or tuple uses the type parameter once. A mutable one uses it
            // several times if it is returned. Any other reference does.
            let is_return_type = place == Place::Return;
            let is_multiple_uses = match ty.tuple_target() {
                Some(target) => is_return_type && !target.readonly(),
                None if ty.is_array_type() => {
                    is_return_type && ty.symbol().is_some_and(|symbol| symbol.name() == b"Array")
                }
                None => true,
            };
            let uses = match self.from_class || is_multiple_uses {
                true => Uses::Multiple,
                false => uses,
            };
            for type_argument in ty.get_type_arguments() {
                self.visit_type(type_argument, uses, place);
            }
        } else if flags.contains(TypeFlags::OBJECT) {
            self.visit_object_type(ty);
        } else {
            match ty.structure() {
                TypeStructure::IndexedAccess { object_type, index_type } => {
                    self.visit_type(object_type, uses, Place::Elsewhere);
                    self.visit_type(index_type, uses, Place::Elsewhere);
                }
                TypeStructure::TemplateLiteral { types, .. } => self.visit_types_list(types, uses),
                TypeStructure::Conditional { check_type, extends_type, .. } => {
                    self.visit_type(check_type, uses, Place::Elsewhere);
                    self.visit_type(extends_type, uses, Place::Elsewhere);
                }
                // `keyof T`, `Uppercase<T>`
                TypeStructure::Index { ty } | TypeStructure::StringMapping { ty } => {
                    self.visit_type(ty, uses, Place::Elsewhere);
                }
                _ => {}
            }
        }
    }

    fn visit_type_parameter(&mut self, ty: Type<'a>, uses: Uses) {
        self.found_or_left_out += 1;
        let Some(declaration) = ty.get_symbol().and_then(|symbol| symbol.declarations().next()) else {
            return;
        };
        // The `this` type is declared by the class.
        if declaration.kind() != SyntaxKind::TypeParameter {
            return;
        }
        *self.found_identifier_usages.entry(declaration).or_insert(0) += match uses {
            Uses::One => 1,
            Uses::Multiple => 2,
        };

        if let Some(constraint) = declaration.constraint()
            && self.visited_constraints.insert(constraint)
        {
            self.visit_type(constraint.get_type_at_location(), Uses::One, Place::Elsewhere);
        }
        if let Some(default) = declaration.default_type()
            && !self.visited_default
        {
            self.visited_default = true;
            self.visit_type(default.get_type_at_location(), Uses::One, Place::Elsewhere);
        }
    }

    /// What is not a reference: there the properties of a generic interface or class, like
    /// `Map<K, V>`, are not looked into.
    fn visit_object_type(&mut self, ty: Type<'a>) {
        let properties = ty.get_properties();
        let is_oxlint = ty.file().language().is_oxlint;
        // tsgolint looks at the properties each time: `{ a: T }` in a parameter and in what is returned is two uses.
        if self.visited_symbol_lists.insert(ty) || is_oxlint {
            for symbol in properties {
                self.visit_type(symbol.get_type(), Uses::One, Place::Elsewhere);
            }
        } else {
            self.found_or_left_out += 1;
        }

        if let TypeStructure::Mapped {
            type_parameter,
            constraint_type,
            name_type,
            template_type,
            ..
        } = ty.structure()
        {
            self.visit_type(type_parameter, Uses::One, Place::Elsewhere);
            // `{ [k in "a"]: T }` is like `{ a: T }`: its properties have been counted.
            if properties.is_empty() && is_oxlint {
                // tsgolint reads the template type where the checker keeps it, which is not on an instantiation: of
                // that it visits the constraint type. An instantiation has a type parameter of its own.
                let declared = type_parameter.get_symbol().map(|symbol| symbol.get_declared_type());
                let visited = match declared.is_some_and(|declared| declared != type_parameter) {
                    true => constraint_type,
                    false => template_type,
                };
                self.visit_type(visited, Uses::One, Place::Elsewhere);
            } else if properties.is_empty() {
                self.visit_type(template_type, Uses::One, Place::Elsewhere);
                // The declaration of the type parameter has the constraint from before the
                // instantiation.
                if get_declared_constraint_type(type_parameter) != Some(constraint_type) {
                    self.visit_type(constraint_type, Uses::One, Place::Elsewhere);
                }
            }
            // tsgolint does not visit the name type.
            if let Some(name_type) = name_type.filter(|_| !is_oxlint) {
                self.visit_type(name_type, Uses::One, Place::Elsewhere);
            }
        }

        self.visit_types_list(ty.get_number_index_type(), Uses::Multiple);
        self.visit_types_list(ty.get_string_index_type(), Uses::Multiple);

        for signature in ty.get_call_signatures() {
            self.visit_signature(signature);
        }
        for signature in ty.get_construct_signatures() {
            self.visit_signature(signature);
        }
    }

    fn visit_signature(&mut self, signature: Signature<'a>) {
        if let Some(this_parameter) = signature.this_parameter() {
            self.visit_type(this_parameter.get_type(), Uses::One, Place::Elsewhere);
        }
        for parameter in signature.parameters() {
            self.visit_type(parameter.get_type(), Uses::One, Place::Elsewhere);
        }
        self.visit_types_list(signature.type_parameters(), Uses::One);

        let predicate_type = signature.get_type_predicate().and_then(|predicate| predicate.ty());
        self.visit_type(predicate_type.unwrap_or_else(|| signature.get_return_type()), Uses::One, Place::Return);
    }
}

fn collect_type_parameter_usage_counts<'a>(
    node: TsNode<'a>,
    found_identifier_usages: &mut Counts<'a>,
    from_class: bool,
    without_type_parameters: &mut TypesWithoutTypeParameters<'a>,
) {
    let mut counter = UsageCounter {
        found_identifier_usages,
        from_class,
        visited_symbol_lists: IdSet::new(),
        type_usages: IdMap::new(),
        visited_constraints: FxHashSet::default(),
        visited_default: false,
        without_type_parameters,
        found_or_left_out: 0,
    };
    match node.kind() {
        SyntaxKind::CallSignature | SyntaxKind::Constructor => {
            if let Some(signature) = node.get_signature_from_declaration() {
                counter.visit_signature(signature);
            }
        }
        _ => counter.visit_type(node.get_type_at_location(), Uses::One, Place::Elsewhere),
    }
}

fn replace_usages_with_constraint<'a>(
    fixer: Fixer<'a>,
    type_parameters: List<'a, TypeParam<'a>>,
    es_type_parameter: TypeParam<'a>,
    variable: Symbol<'a>,
    jsdoc_references: &[JsdocReference],
) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let constraint = es_type_parameter.constraint();
    // A constraint of `any` acts like `unknown`.
    let constraint_text: &[u8] = match constraint {
        Some(constraint) if !constraint.is_keyword(Keyword::Any) => constraint.text(),
        _ => b"unknown",
    };
    let is_weak_precedence_constraint = constraint.is_some_and(|it| {
        matches!(
            it.kind(),
            TypeKind::Union(_)
                | TypeKind::Intersection(_)
                | TypeKind::Cond { .. }
                | TypeKind::Keyof(_)
                | TypeKind::Readonly(_)
                | TypeKind::UniqueSymbol
                | TypeKind::Fn(_)
        )
    });

    let removed = if type_parameters.len() == 1 {
        type_parameters.angle_brackets_span()?
    } else if type_parameters.first() == Some(es_type_parameter) {
        let comma_after = file.tokens_after(es_type_parameter).find(|token| token.value() == b",")?;
        let token_after_comma = file.tokens_after(comma_after).with_comments().next()?;
        Span::new(es_type_parameter.span().start, token_after_comma.start())
    } else {
        let comma_before = file.tokens_before(es_type_parameter).find(|token| token.value() == b",")?;
        Span::new(comma_before.start(), es_type_parameter.span().end)
    };
    let is_oxlint = file.language().is_oxlint;

    let mut fixes = Vec::new();
    for reference in variable.references() {
        let is_reference = match is_oxlint {
            true => is_identifier_of_type_node(reference),
            false => reference.is_type(),
        };
        let type_reference = match reference.node() {
            Node::Type(type_reference) if is_reference => type_reference,
            // tsgolint replaces the parent of the identifier, which is the `typeof T` of a value of the name.
            Node::Expr(operand) if is_reference && is_oxlint => match operand.parent() {
                Node::Type(type_query) => type_query,
                _ => continue,
            },
            _ => continue,
        };
        // tsgolint leaves what goes with the type parameter, as in `<T extends { a: T }>`.
        let identifier = reference.span();
        if is_oxlint && identifier.start < removed.end && identifier.end > removed.start {
            continue;
        }
        // tsgolint has a node for parentheses: `(T)[]` needs no more of them.
        let is_weak_precedence_type_parent = matches!(
            type_reference.parent(),
            Node::Type(grandparent) if matches!(
                grandparent.kind(),
                TypeKind::Array(_)
                    | TypeKind::IndexedAccess { .. }
                    | TypeKind::Intersection(_)
                    | TypeKind::Union(_)
                    | TypeKind::Cond { .. }
                    | TypeKind::Keyof(_)
                    | TypeKind::Readonly(_)
            )
        ) && !(is_oxlint && type_reference.is_parenthesized());
        fixes.push(match is_weak_precedence_constraint && is_weak_precedence_type_parent {
            true => fixer.replace(type_reference, [&b"("[..], constraint_text, b")"].concat()),
            false => fixer.replace(type_reference, constraint_text),
        });
    }

    // A constraint with a `*/` in it would end the comment.
    let fits_in_a_comment = !strings::contains(constraint_text, b"*/");
    for reference in jsdoc_references.iter().filter(|_| fits_in_a_comment) {
        fixes.push(match is_weak_precedence_constraint && reference.is_weak_precedence_type_parent {
            true => fixer.replace(reference.identifier, [&b"("[..], constraint_text, b")"].concat()),
            false => fixer.replace(reference.identifier, constraint_text),
        });
    }

    fixes.push(fixer.remove(removed));
    Some(fixes)
}

fn check_node<'a>(
    cx: &mut Cx<'a, NoUnnecessaryTypeParameters>,
    node: Node<'a>,
    type_parameters: List<'a, TypeParam<'a>>,
    start_of_body: u32,
    descriptor: &'static str,
    count_type_parameter_usage: impl Fn(&mut State<'a>) -> Rc<Counts<'a>>,
) {
    let mut counts = None;
    for type_parameter in type_parameters {
        let Some(variable) = type_parameter.symbol() else {
            continue;
        };
        // If it is written several times, the types need not be asked.
        let is_oxlint = cx.language().is_oxlint;
        if is_type_parameter_repeated_in_ast(type_parameter, variable.references(), start_of_body, is_oxlint, 0) {
            continue;
        }
        let name = type_parameter.name();
        let mut jsdoc_references = JsdocReferences::new();
        if is_oxlint {
            collect_jsdoc_references_of_signature(node, name.bytes(), &mut jsdoc_references);
            let found_in_jsdoc = jsdoc_references.len() as u32;
            let references = variable.references();
            if found_in_jsdoc >= 2
                || (found_in_jsdoc == 1
                    && is_type_parameter_repeated_in_ast(type_parameter, references, start_of_body, is_oxlint, 1))
            {
                continue;
            }
        }
        // Inferred types take the type checker.
        let counts = counts.get_or_insert_with(|| count_type_parameter_usage(&mut cx.state));
        // tsgolint counts by the symbol, which a class has in common with an interface of its name.
        let declaration = match is_oxlint {
            true => {
                let symbol = type_parameter.ts_node().get_type_at_location().get_symbol();
                symbol.and_then(|symbol| symbol.declarations().next())
            }
            false => Some(type_parameter.ts_node()),
        };
        let uses = match declaration.and_then(|declaration| counts.get(&declaration).copied()) {
            Some(1) => "never used",
            Some(2) => "used only once",
            _ => continue,
        };
        // tsgolint walks the body too: what it finds in a JSDoc comment there is no use of the signature, but can be
        // the first reference, and the suggestion replaces it.
        if is_oxlint {
            let (file, end_of_node) = (node.file(), node.span().end);
            let body = Span::new(start_of_body.min(end_of_node), end_of_node);
            for comment in file.comments_in(body) {
                let known = jsdoc_references.len();
                collect_jsdoc_references(file, comment, name.bytes(), &mut jsdoc_references);
                let documented = skip_trivia(file.text(), comment.end());
                if jsdoc_references.len() > known && is_shadowed(variable.scope(), name.name(), documented) {
                    jsdoc_references.truncate(known);
                }
            }
        }
        // oxlint points at where it is used first.
        let place = match is_oxlint {
            true => {
                let in_ast = variable.references().find(|&reference| is_identifier_of_type_node(reference));
                match (in_ast.map(|reference| reference.span()), jsdoc_references.first()) {
                    (Some(in_ast), Some(in_jsdoc)) if in_jsdoc.identifier.start < in_ast.start => in_jsdoc.identifier,
                    (Some(in_ast), _) => in_ast,
                    (None, Some(in_jsdoc)) => in_jsdoc.identifier,
                    (None, None) => name.span(),
                }
            }
            false => type_parameter.span(),
        };
        cx.report(place, SOLE)
            .comments_apply_at(type_parameter.span())
            .data("name", type_parameter.name())
            .data("descriptor", descriptor)
            .data("uses", uses)
            .labels_with(|labels| {
                let name = bstr::BStr::new(type_parameter.name().bytes());
                labels.first(format!("This is the only usage of type parameter {name} in the signature."));
                labels.push(type_parameter.span(), "");
            })
            .suggest(REPLACE_USAGES_WITH_CONSTRAINT, |fixer| {
                replace_usages_with_constraint(fixer, type_parameters, type_parameter, variable, &jsdoc_references)
            });
    }
}

impl Rule for NoUnnecessaryTypeParameters {
    const META: Meta = Meta::typescript("no-unnecessary-type-parameters", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().funcs().classes();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnnecessaryTypeParameters
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<State<'a>> {
        Some(State::default())
    }

    fn func<'a>(&self, node: Func<'a>, cx: &mut Cx<'a, Self>) {
        let type_parameters = node.type_params();
        // Upstream does not listen for a `TSConstructSignatureDeclaration`.
        if type_parameters.is_empty() || node.kind() == FnKind::ConstructSignature {
            return;
        }
        let start_of_body = match node.body() {
            FnBody::Block(_) => node.body_span().map(|body| body.start),
            // For tsgolint what a returned function mentions is part of the signature.
            FnBody::Expr(body) if cx.language().is_oxlint && body.as_fn().is_some() && !body.is_parenthesized() => None,
            FnBody::Expr(body) => Some(body.span().start),
            FnBody::None => node.return_type().map(|return_type| return_type.annotation_span().end),
        };
        check_node(cx, Node::Func(node), type_parameters, start_of_body.unwrap_or(u32::MAX), "function", |known| {
            let ts_node = node.ts_node();
            let State { counts_by_type, without_type_parameters } = known;
            let mut count = || {
                let mut counts = Counts::default();
                collect_type_parameter_usage_counts(ts_node, &mut counts, false, without_type_parameters);
                Rc::new(counts)
            };
            match ts_node.kind() {
                SyntaxKind::CallSignature | SyntaxKind::Constructor => count(),
                // Each overload of a function has the type of the function, with the signatures of all of them.
                _ => {
                    let ty = ts_node.get_type_at_location();
                    Rc::clone(counts_by_type.get_or_insert_with(ty, count))
                }
            }
        });
    }

    fn class<'a>(&self, node: Class<'a>, cx: &mut Cx<'a, Self>) {
        let type_parameters = node.type_params();
        if type_parameters.is_empty() {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        check_node(cx, Node::Class(node), type_parameters, node.body_span().start, "class", |known| {
            let (mut counts, known) = (Counts::default(), &mut known.without_type_parameters);
            for type_parameter in type_parameters {
                collect_type_parameter_usage_counts(type_parameter.ts_node(), &mut counts, true, known);
            }
            // tsgolint also looks at what the class extends and implements. Upstream leaves out a type argument.
            let clauses = node.ts_node().children().filter(|it| is_oxlint && it.kind() == SyntaxKind::HeritageClause);
            for heritage_type in clauses.flat_map(|clause| clause.children()) {
                collect_type_parameter_usage_counts(heritage_type, &mut counts, true, known);
            }
            // A static block has no type.
            for member in node.members().iter().filter(|member| member.kind() != MemberKind::StaticBlock) {
                collect_type_parameter_usage_counts(member.ts_node(), &mut counts, true, known);
            }
            Rc::new(counts)
        });
    }
}
