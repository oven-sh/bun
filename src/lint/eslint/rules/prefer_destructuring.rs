use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require destructuring from arrays and/or objects.
pub struct PreferDestructuring {
    config: Config,
    /// An option of typescript-eslint's rule, which oxlint's port of this rule also has.
    enforce_for_declaration_with_type_annotation: bool,
}

pub const PREFER_DESTRUCTURING: Message =
    Message::new("preferDestructuring", "Use {{type}} destructuring.");

const PRECEDENCE_OF_ASSIGNMENT_EXPR: i32 = 1;

/// Returns `kind` as the message prints it. oxlint capitalizes it.
fn type_in_message<R: Rule>(kind: &'static str, cx: &Cx<'_, R>) -> &'static str {
    match (cx.language().is_oxlint, kind) {
        (false, _) => kind,
        (true, "object") => "Object",
        (true, _) => "Array",
    }
}

/// The kinds of destructuring enforced for one kind of node.
#[derive(Copy, Clone, Default)]
pub struct Enabled {
    pub array: bool,
    pub object: bool,
}

impl Enabled {
    pub fn new(object: Object) -> Enabled {
        Enabled {
            array: object.bool_or("array", false),
            object: object.bool_or("object", false),
        }
    }
}

/// The options. typescript-eslint's rule of the same name runs this rule after its own checks.
pub struct Config {
    pub variable_declarator: Enabled,
    pub assignment_expression: Enabled,
    pub enforce_for_renamed_properties: bool,
}

/// The `property` of a `MemberExpression`.
#[derive(Copy, Clone)]
enum Property<'a> {
    /// `object.name`
    Name(Name<'a>),
    /// `object[index]`
    Computed(Expr<'a>),
}

impl<'a> Property<'a> {
    /// True if it's the name `left`, or a string with that text.
    fn is_named(self, left: Option<Name<'a>>) -> bool {
        match self {
            Property::Name(name) => left == Some(name),
            Property::Computed(index) => left.is_some() && left == index.as_string(),
        }
    }
}

/// Returns `e` as a `MemberExpression` that could be destructured: not an optional chain, not on `super`, and not a
/// private name.
fn member_expression(e: Expr<'_>) -> Option<(Expr<'_>, Property<'_>)> {
    let (object, property) = match e.as_dot() {
        Some(_) if e.is_private_member() => return None,
        Some((obj, name, _)) => (obj, Property::Name(name.name())),
        None => {
            let (obj, index, _) = e.as_index()?;
            (obj, Property::Computed(index))
        }
    };
    (!e.is_in_optional_chain() && object.tag() != ExprTag::Super).then_some((object, property))
}

impl Config {
    pub fn new(options: &Options) -> Config {
        let types = options.object(0);
        let (variable_declarator, assignment_expression) = if options.get(0).is_none() {
            let all = Enabled {
                array: true,
                object: true,
            };
            (all, all)
        } else if types.has("array") || types.has("object") {
            (Enabled::new(types), Enabled::new(types))
        } else {
            (
                Enabled::new(types.object("VariableDeclarator")),
                Enabled::new(types.object("AssignmentExpression")),
            )
        };
        Config {
            variable_declarator,
            assignment_expression,
            enforce_for_renamed_properties: options
                .object(1)
                .bool_or("enforceForRenamedProperties", false),
        }
    }

    /// Returns the kind of destructuring to use instead of assigning `object.property`, or `None` if there's nothing to
    /// report. `left` is the target's name, if the target is an identifier.
    fn perform_check<'a>(
        &self,
        enabled: Enabled,
        left: Option<Name<'a>>,
        property: Property<'a>,
        is_port_of_oxlint: bool,
    ) -> Option<&'static str> {
        // oxlint's port treats every number as an index, and doesn't report a template.
        if let Property::Computed(index) = property
            && let Some(n) = index.as_number()
            && (is_port_of_oxlint || n.is_finite() && n.fract() == 0.0)
        {
            return enabled.array.then_some("array");
        }
        let is_template =
            matches!(property, Property::Computed(index) if index.tag() == ExprTag::Template);
        if !enabled.object || is_port_of_oxlint && is_template {
            return None;
        }
        let has_same_name = property.is_named(left);
        (self.enforce_for_renamed_properties || has_same_name).then_some("object")
    }

    /// ESLint's listener for a `VariableDeclarator`. The fix is only offered if `can_fix` is true.
    #[inline(never)]
    pub fn check_variable_declarator<'a, R: Rule>(
        &self,
        declaration: VarDecl<'a>,
        cx: &Cx<'a, R>,
        can_fix: bool,
    ) {
        let Some((object, property)) = declaration.init().and_then(member_expression) else {
            return;
        };
        if matches!(declaration.var_kind(), VarKind::Using | VarKind::AwaitUsing) {
            return;
        }
        let left = declaration.pat().as_ident();
        let is_port_of_oxlint = cx.language().is_oxlint && R::META.plugin == Plugin::Eslint;
        let Some(kind) =
            self.perform_check(self.variable_declarator, left, property, is_port_of_oxlint)
        else {
            return;
        };
        let has_same_name = property.is_named(left);
        // oxlint's port of ESLint's rule points at the initializer, without its parentheses if the names differ.
        let location = match declaration.init() {
            Some(init) if is_port_of_oxlint && kind == "object" && !has_same_name => init.span(),
            Some(init) if is_port_of_oxlint => init.outer_span(),
            _ => declaration.span(),
        };
        let report = cx
            .report(location, PREFER_DESTRUCTURING)
            .claims(declaration)
            .unless_claimed(declaration)
            .called_with(declaration);
        let report = report
            .data("type", type_in_message(kind, cx))
            .data("kind", kind);
        // oxlint's port also fixes `let x = a["x"]`, doesn't check for comments, and keeps most parentheses.
        if is_port_of_oxlint {
            if kind == "object" && has_same_name && declaration.ty().is_none() {
                report.fix(|fixer| {
                    let file = fixer.file();
                    let name = match property {
                        Property::Name(name) => name.bytes(),
                        Property::Computed(index) => file.slice(index.span().shrink(1, 1)),
                    };
                    let needs_no_parentheses = !object.is_chain_root()
                        && matches!(
                            object.tag(),
                            ExprTag::Call
                                | ExprTag::Ident
                                | ExprTag::Dot
                                | ExprTag::Index
                                | ExprTag::This
                        );
                    let object = if needs_no_parentheses {
                        object.span()
                    } else {
                        object.outer_span()
                    };
                    fixer.replace(
                        declaration,
                        [&b"{"[..], name, b"} = ", file.slice(object)].concat(),
                    )
                });
            }
            return;
        }
        // Only fix `let x = a.x`. ESLint also rewrites `let x: T = a.x`, which drops the `T`.
        if can_fix
            && declaration.ty().is_none()
            && kind == "object"
            && let Property::Name(name) = property
            && left == Some(name)
        {
            report.fix(|fixer| {
                let file = fixer.file();
                if file.comments_in(declaration).len() > file.comments_in(object).len() {
                    return None;
                }
                let text = match ast_utils::get_precedence(object) < PRECEDENCE_OF_ASSIGNMENT_EXPR {
                    true => [&b"{"[..], name.bytes(), b"} = (", object.text(), b")"].concat(),
                    false => [&b"{"[..], name.bytes(), b"} = ", object.text()].concat(),
                };
                Some(fixer.replace(declaration, text))
            });
        }
    }

    /// ESLint's listener for an `AssignmentExpression`.
    #[inline(never)]
    pub fn check_assignment_expression<'a, R: Rule>(&self, e: Expr<'a>, cx: &Cx<'a, R>) {
        let Some((None, target, value)) = e.as_assign() else {
            return;
        };
        let Some((_, property)) = member_expression(value) else {
            return;
        };
        let (enabled, left) = (self.assignment_expression, target.as_ident());
        // In oxlint's port, `enforceForRenamedProperties` only applies to `a = b[c]`, and `a = b["a"]` gets one more
        // report, whatever the options are.
        if cx.language().is_oxlint && R::META.plugin == Plugin::Eslint {
            let (arrays, objects) = match property {
                Property::Name(name) => (0, usize::from(enabled.object && left == Some(name))),
                Property::Computed(index) => match index.kind() {
                    ExprKind::Template(_) => (0, 0),
                    ExprKind::Number(_) => (usize::from(enabled.array), 0),
                    ExprKind::String(name) => (
                        0,
                        usize::from(self.enforce_for_renamed_properties && enabled.object)
                            + usize::from(left == Some(name)),
                    ),
                    _ => (
                        0,
                        usize::from(self.enforce_for_renamed_properties && enabled.object),
                    ),
                },
            };
            if arrays + objects == 0 || utils::is_assignment_target(e) {
                return;
            }
            let arrays = std::iter::repeat_n(("Array", "array"), arrays);
            for (capitalized, kind) in
                arrays.chain(std::iter::repeat_n(("Object", "object"), objects))
            {
                cx.report(e, PREFER_DESTRUCTURING)
                    .unless_claimed(e)
                    .data("type", capitalized)
                    .data("kind", kind);
            }
            return;
        }
        if let Some(kind) = self.perform_check(enabled, left, property, false)
            // A default value in a pattern isn't an assignment.
            && !utils::is_assignment_target(e)
        {
            cx.report(e, PREFER_DESTRUCTURING)
                .claims(e)
                .unless_claimed(e)
                .data("type", type_in_message(kind, cx))
                .data("kind", kind);
        }
    }
}

#[inline]
fn is_member(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::Dot | ExprTag::Index)
}

fn is_enabled(it: Enabled) -> bool {
    it.array || it.object
}

impl Rule for PreferDestructuring {
    const META: Meta =
        Meta::eslint("prefer-destructuring", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Assign]).var_decls();
    no_state!();

    fn new(options: &Options) -> Self {
        PreferDestructuring {
            config: Config::new(options),
            enforce_for_declaration_with_type_annotation: options
                .object(1)
                .bool_or("enforceForDeclarationWithTypeAnnotation", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if is_enabled(self.config.variable_declarator) {
            on = on.var_decls();
        }
        if is_enabled(self.config.assignment_expression) || file.language().is_oxlint {
            on = on.exprs(&[ExprTag::Assign]);
        }
        on
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if e.right().is_some_and(is_member) {
            self.config.check_assignment_expression(e, cx);
        }
    }

    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if !declaration.init().is_some_and(is_member) {
            return;
        }
        let has_type_annotation = cx.language().is_oxlint && declaration.ty().is_some();
        if !has_type_annotation || self.enforce_for_declaration_with_type_annotation {
            self.config
                .check_variable_declarator(declaration, cx, !has_type_annotation);
        }
    }
}
