use bun_lint::prelude::*;
use bun_lint::types::tsutils::is_type_reference;
use bun_lint::types::{Signature, SyntaxKind, TsNode, Type, TypeFlags, TypeStructure};
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;

/// Disallow type parameters that aren't used multiple times.
pub struct NoUnnecessaryTypeParameters;

const REPLACE_USAGES_WITH_CONSTRAINT: Message = Message::new(
    "replaceUsagesWithConstraint",
    "Replace all usages of type parameter with its constraint.",
);
const SOLE: Message =
    Message::new("sole", "Type parameter {{name}} is {{uses}} in the {{descriptor}} signature.");

/// How deep types are followed. Upstream has no bound.
const MAX_DEPTH: u32 = 100;

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

fn is_type_parameter_repeated_in_ast<'a>(
    node: TypeParam<'a>,
    references: impl Iterator<Item = Reference<'a>>,
    start_of_body: u32,
) -> bool {
    let definition = node.span();
    let mut total = 0;
    for reference in references {
        let identifier = reference.span();
        // What is inside the definition of the type parameter does not count, nor what is outside
        // the signature, nor a value of the same name.
        if (identifier.start < definition.end && identifier.end > definition.start)
            || identifier.start > start_of_body
            || !reference.is_type()
        {
            continue;
        }
        if is_type_argument(reference) {
            return true;
        }
        total += 1;
        if total >= 2 {
            return true;
        }
    }
    false
}

/// By the declaration of the type parameter.
type Counts<'a> = FxHashMap<TsNode<'a>, u32>;

#[derive(Default)]
pub struct State<'a> {
    /// What has been counted in the type of a function.
    counts_by_type: FxHashMap<Type<'a>, Rc<Counts<'a>>>,
    without_type_parameters: TypesWithoutTypeParameters<'a>,
}

/// The types that have been gone through to the end, and no type parameter was found. To go through one again counts
/// nothing, whatever has been visited before, and many functions mention the same large types.
type TypesWithoutTypeParameters<'a> = FxHashSet<Type<'a>>;

/// Upstream's `collectTypeParameterUsageCounts`: how often each type parameter appears in a type.
struct UsageCounter<'a, 'c> {
    found_identifier_usages: &'c mut Counts<'a>,
    /// The type parameters are those of a class, or of one of its methods.
    from_class: bool,
    /// Upstream has the lists of properties, of which each type has its own.
    visited_symbol_lists: FxHashSet<Type<'a>>,
    type_usages: FxHashMap<Type<'a>, u32>,
    visited_constraints: FxHashSet<TsNode<'a>>,
    visited_default: bool,
    depth: u32,
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
        if self.without_type_parameters.contains(&ty) {
            return;
        }
        let usages = self.type_usages.entry(ty).or_insert(0);
        *usages += 1;
        if *usages > 9 || self.depth >= MAX_DEPTH {
            self.found_or_left_out += 1;
            return;
        }
        let before = self.found_or_left_out;
        self.depth += 1;
        self.visit_parts(ty, uses, place);
        self.depth -= 1;
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
        if self.visited_symbol_lists.insert(ty) {
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
            if properties.is_empty() {
                self.visit_type(template_type, Uses::One, Place::Elsewhere);
                // The declaration of the type parameter has the constraint from before the
                // instantiation.
                if get_declared_constraint_type(type_parameter) != Some(constraint_type) {
                    self.visit_type(constraint_type, Uses::One, Place::Elsewhere);
                }
            }
            if let Some(name_type) = name_type {
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
        visited_symbol_lists: FxHashSet::default(),
        type_usages: FxHashMap::default(),
        visited_constraints: FxHashSet::default(),
        visited_default: false,
        depth: 0,
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

    let mut fixes = Vec::new();
    for reference in variable.references().filter(|reference| reference.is_type()) {
        let Node::Type(type_reference) = reference.node() else {
            continue;
        };
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
        );
        fixes.push(match is_weak_precedence_constraint && is_weak_precedence_type_parent {
            true => fixer.replace(type_reference, [&b"("[..], constraint_text, b")"].concat()),
            false => fixer.replace(type_reference, constraint_text),
        });
    }

    fixes.push(if type_parameters.len() == 1 {
        fixer.remove(type_parameters.angle_brackets_span()?)
    } else if type_parameters.first() == Some(es_type_parameter) {
        let comma_after = file.tokens_after(es_type_parameter).find(|token| token.value() == b",")?;
        let token_after_comma = file.tokens_after(comma_after).with_comments().next()?;
        fixer.remove(Span::new(es_type_parameter.span().start, token_after_comma.start()))
    } else {
        let comma_before = file.tokens_before(es_type_parameter).find(|token| token.value() == b",")?;
        fixer.remove(Span::new(comma_before.start(), es_type_parameter.span().end))
    });
    Some(fixes)
}

fn check_node<'a>(
    cx: &mut Cx<'a, NoUnnecessaryTypeParameters>,
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
        if is_type_parameter_repeated_in_ast(type_parameter, variable.references(), start_of_body) {
            continue;
        }
        // Inferred types take the type checker.
        let counts = counts.get_or_insert_with(|| count_type_parameter_usage(&mut cx.state));
        let uses = match counts.get(&type_parameter.ts_node()).copied() {
            Some(1) => "never used",
            Some(2) => "used only once",
            _ => continue,
        };
        // oxlint points at where it is used.
        let place = match variable.references().next().filter(|_| cx.language().is_oxlint) {
            Some(reference) => reference.span(),
            None if cx.language().is_oxlint => type_parameter.name().span(),
            None => type_parameter.span(),
        };
        cx.report(place, SOLE)
            .comments_apply_at(type_parameter.span())
            .data("name", type_parameter.name())
            .data("descriptor", descriptor)
            .data("uses", uses)
            .suggest(REPLACE_USAGES_WITH_CONSTRAINT, |fixer| {
                replace_usages_with_constraint(fixer, type_parameters, type_parameter, variable)
            });
    }
}

impl Rule for NoUnnecessaryTypeParameters {
    const META: Meta = Meta::typescript("no-unnecessary-type-parameters", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoUnnecessaryTypeParameters
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.funcs(|_, node, cx| {
            let type_parameters = node.type_params();
            // Upstream does not listen for a `TSConstructSignatureDeclaration`.
            if type_parameters.is_empty() || node.kind() == FnKind::ConstructSignature {
                return;
            }
            let start_of_body = match node.body() {
                FnBody::Block(_) => node.body_span().map(|body| body.start),
                FnBody::Expr(body) => Some(body.span().start),
                FnBody::None => node.return_type().map(|return_type| return_type.annotation_span().end),
            };
            check_node(cx, type_parameters, start_of_body.unwrap_or(u32::MAX), "function", |known| {
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
                    _ => Rc::clone(counts_by_type.entry(ts_node.get_type_at_location()).or_insert_with(count)),
                }
            });
        });
        on.classes(|_, node, cx| {
            let type_parameters = node.type_params();
            if type_parameters.is_empty() {
                return;
            }
            check_node(cx, type_parameters, node.body_span().start, "class", |known| {
                let (mut counts, known) = (Counts::default(), &mut known.without_type_parameters);
                for type_parameter in type_parameters {
                    collect_type_parameter_usage_counts(type_parameter.ts_node(), &mut counts, true, known);
                }
                // A static block has no type.
                for member in node.members().iter().filter(|member| member.kind() != MemberKind::StaticBlock) {
                    collect_type_parameter_usage_counts(member.ts_node(), &mut counts, true, known);
                }
                Rc::new(counts)
            });
        });
        State::default()
    }
}
