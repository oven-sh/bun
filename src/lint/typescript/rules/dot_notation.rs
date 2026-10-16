use bun_lint::prelude::*;
use bun_lint::types::tsutils::{CompilerOption, is_compiler_option_enabled};
use bun_lint::types::{ModifierFlags, SyntaxKind, TypeFlags};
use bun_lint_eslint::rules::dot_notation::DotNotation as BaseRule;

/// Enforce dot notation whenever possible.
pub struct DotNotation {
    base: BaseRule,
    allow_index_signature_property_access: bool,
    allow_private_class_property_access: bool,
    allow_protected_class_property_access: bool,
}

/// `symbol.escapedName === value`, for a symbol that is named `name`: TypeScript puts one more `_`
/// before a name that starts with two.
fn escaped_name_is(name: &[u8], value: &[u8]) -> bool {
    match name.starts_with(b"__") {
        true => value.split_first() == Some((&b'_', name)),
        false => name == value,
    }
}

/// tsgolint's `getStaticPropertyName`: of a string literal, or of a template without substitutions.
fn get_static_property_name(index: Expr<'_>) -> Option<Name<'_>> {
    match index.kind() {
        ExprKind::Template(template) => template.as_static(),
        _ => index.as_string(),
    }
}

impl DotNotation {
    /// Whether what the types say about `obj[index]`, which is `node`, allows the brackets.
    fn is_allowed_by_types<'a>(
        &self,
        (node, obj, index): (Expr<'a>, Expr<'a>, Expr<'a>),
        allow_index_signature_property_access: bool,
    ) -> bool {
        let is_oxlint = obj.file().language().is_oxlint;
        let property_symbol = index.ts_symbol().or_else(|| {
            // tsgolint compares with the name as it is written, also that of a template.
            let value = if is_oxlint { get_static_property_name(index)? } else { index.as_string()? };
            let properties = obj.ty().get_non_nullable_type().get_properties();
            properties.iter().find(|property| match is_oxlint {
                true => property.name() == value.bytes(),
                false => escaped_name_is(property.escaped_name(), value.bytes()),
            })
        });
        // tsgolint finds nothing for what nothing declares: the `a` of a `Record<"a" | "b", T>`.
        let property_symbol = property_symbol.filter(|it| !is_oxlint || it.declarations().next().is_some());
        // Of a getter and a setter tsgolint asks the one that is used.
        let is_updated = matches!(node.parent(), Node::Expr(parent) if matches!(
            parent.kind(),
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. }
        ));
        // For TypeScript's `isWriteAccess` the operand of a spread is read.
        let is_spread_operand = match node.parent() {
            Node::Expr(parent) => parent.tag() == ExprTag::Spread,
            Node::Prop(prop) => prop.kind() == PropKind::Spread,
            _ => false,
        };
        let is_write_access = is_updated || (utils::is_assignment_target(node) && !is_spread_operand);
        // tsgolint's `getRelevantDeclaration`
        let declaration = property_symbol.and_then(|symbol| {
            let accessor = |kind: SyntaxKind| symbol.declarations().find(|it| is_oxlint && it.kind() == kind);
            let (getter, setter) = (accessor(SyntaxKind::GetAccessor), accessor(SyntaxKind::SetAccessor));
            let used = if is_write_access { setter.or(getter) } else { getter.or(setter) };
            used.or_else(|| symbol.declarations().next())
        });
        let (is_private, is_protected) = match declaration {
            // tsgolint's `ast.HasModifier`: wherever it is among the modifiers.
            Some(declaration) if is_oxlint => (
                declaration.has_modifier(ModifierFlags::PRIVATE),
                declaration.has_modifier(ModifierFlags::PROTECTED),
            ),
            // The modifiers are the first children of a declaration.
            Some(declaration) => {
                let modifier_kind = declaration
                    .children()
                    .find(|child| child.kind() != SyntaxKind::Decorator)
                    .map(|modifier| modifier.kind());
                (
                    modifier_kind == Some(SyntaxKind::PrivateKeyword),
                    modifier_kind == Some(SyntaxKind::ProtectedKeyword),
                )
            }
            None => (false, false),
        };
        if (self.allow_private_class_property_access && is_private)
            || (self.allow_protected_class_property_access && is_protected)
        {
            return true;
        }
        // With `noPropertyAccessFromIndexSignature` tsgolint 7.0 asks for no index signature: `(a as any)["b"]`.
        let file = obj.file();
        let needs_no_index_signature = || {
            let options = file.type_checker().compiler_options();
            file.language().is_oxlint
                && is_compiler_option_enabled(options, CompilerOption::NoPropertyAccessFromIndexSignature)
        };
        if property_symbol.is_some() || !allow_index_signature_property_access {
            return false;
        }
        if needs_no_index_signature() {
            return true;
        }
        let mut index_infos = obj.ty().get_non_nullable_type().get_index_infos();
        if !is_oxlint {
            return index_infos.any(|info| info.key_type().has_flags(TypeFlags::STRING_LIKE));
        }
        // tsgolint's `getIndexTypeOfType` with the type of the argument, then with its base type: the
        // index signature with that very key type.
        let key_type = index.ty();
        let base_key_type = key_type.get_base_type_of_literal_type();
        index_infos.any(|info| info.key_type() == key_type || info.key_type() == base_key_type)
    }

    fn check_computed<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Index { obj, index, .. } = node.kind() else {
            return;
        };
        // The base rule reports nothing else.
        if !matches!(
            index.tag(),
            ExprTag::String | ExprTag::Template | ExprTag::True | ExprTag::False | ExprTag::Null
        ) {
            return;
        }
        let allow_index_signature_property_access = cx.state;
        if (self.allow_private_class_property_access
            || self.allow_protected_class_property_access
            || allow_index_signature_property_access)
            && self.is_allowed_by_types((node, obj, index), allow_index_signature_property_access)
        {
            return;
        }
        self.base.check_member_expression(node, cx);
    }
}

impl Rule for DotNotation {
    const META: Meta = Meta::typescript("dot-notation", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types()
        .extends_base_rule("dot-notation");
    const ON: On = On::new()
        .exprs(&[ExprTag::Index, ExprTag::Dot])
        .stmts(&[StmtTag::Interface])
        .classes();
    /// Whether an access that an index signature allows can be written with brackets.
    type State<'a> = bool;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        DotNotation {
            base: BaseRule::new(options),
            allow_index_signature_property_access: object.bool_or("allowIndexSignaturePropertyAccess", false),
            allow_private_class_property_access: object.bool_or("allowPrivateClassPropertyAccess", false),
            allow_protected_class_property_access: object.bool_or("allowProtectedClassPropertyAccess", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Index]);
        if !self.base.checks_keywords() {
            return on;
        }
        let on = on.exprs(&[ExprTag::Dot]);
        if file.is_javascript() { on } else { on.classes().stmts(&[StmtTag::Interface]) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<bool> {
        Some(
            self.allow_index_signature_property_access
                || is_compiler_option_enabled(
                    file.type_checker().compiler_options(),
                    CompilerOption::NoPropertyAccessFromIndexSignature,
                ),
        )
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Index => self.check_computed(node, cx),
            ExprTag::Dot => self.base.check_member_expression(node, cx),
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Interface(interface) = statement.kind() {
            for ty in interface.extends() {
                self.base.check_heritage(ty, cx);
            }
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        for ty in class.implements() {
            self.base.check_heritage(ty, cx);
        }
    }
}
