use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require destructuring from arrays and/or objects.
pub struct PreferDestructuring {
    config: Config,
    /// An option of typescript-eslint's rule, which oxlint's port of this one has.
    enforce_for_declaration_with_type_annotation: bool,
}

pub const PREFER_DESTRUCTURING: Message =
    Message::new("preferDestructuring", "Use {{type}} destructuring.");

const PRECEDENCE_OF_ASSIGNMENT_EXPR: i32 = 1;

/// `kind` as the message has it: oxlint writes it with a capital.
fn type_in_message<R: Rule>(kind: &'static str, cx: &Cx<'_, R>) -> &'static str {
    match (cx.language().is_oxlint, kind) {
        (false, _) => kind,
        (true, "object") => "Object",
        (true, _) => "Array",
    }
}

/// Which kinds of destructuring are enforced for a kind of node.
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

/// The options. typescript-eslint's rule of the same name runs this rule after checks of its own.
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
    /// Whether it is written as the name `left`, or as a string with that text.
    fn is_called(self, left: Option<Name<'a>>) -> bool {
        match self {
            Property::Name(name) => left == Some(name),
            Property::Computed(index) => left.is_some() && left == index.as_string(),
        }
    }
}

/// `e` as a `MemberExpression` that could be destructured: not an optional chain, not of `super`,
/// not of a private name.
fn member_expression(e: Expr<'_>) -> Option<(Expr<'_>, Property<'_>)> {
    let (object, property) = match e.kind() {
        ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") => (obj, Property::Name(name.name())),
        ExprKind::Index { obj, index, .. } => (obj, Property::Computed(index)),
        _ => return None,
    };
    (!e.is_in_optional_chain() && object.tag() != ExprTag::Super).then_some((object, property))
}

impl Config {
    pub fn new(options: &Options) -> Config {
        let types = options.object(0);
        let (variable_declarator, assignment_expression) = if options.get(0).is_none() {
            let all = Enabled { array: true, object: true };
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
            enforce_for_renamed_properties: options.object(1).bool_or("enforceForRenamedProperties", false),
        }
    }

    /// The kind of destructuring to use instead of assigning `object.property` to `left`, which is
    /// the name if that is an identifier. `None` if there is nothing to report.
    fn perform_check<'a>(
        &self,
        enabled: Enabled,
        left: Option<Name<'a>>,
        property: Property<'a>,
        is_port_of_oxlint: bool,
    ) -> Option<&'static str> {
        // For oxlint's port every number is an index, and it says nothing about a template.
        if let Property::Computed(index) = property
            && let ExprKind::Number(n) = index.kind()
            && (is_port_of_oxlint || n.is_finite() && n.fract() == 0.0)
        {
            return enabled.array.then_some("array");
        }
        let is_template = matches!(property, Property::Computed(index) if index.tag() == ExprTag::Template);
        if !enabled.object || is_port_of_oxlint && is_template {
            return None;
        }
        let has_same_name = property.is_called(left);
        (self.enforce_for_renamed_properties || has_same_name).then_some("object")
    }

    /// ESLint's listener for a `VariableDeclarator`. `can_fix`: whether to offer the fix.
    pub fn check_variable_declarator<'a, R: Rule>(&self, declaration: VarDecl<'a>, cx: &Cx<'a, R>, can_fix: bool) {
        let Some((object, property)) = declaration.init().and_then(member_expression) else {
            return;
        };
        if matches!(declaration.var_kind(), VarKind::Using | VarKind::AwaitUsing) {
            return;
        }
        let left = declaration.pat().as_ident();
        let is_port_of_oxlint = cx.language().is_oxlint && R::META.plugin == Plugin::Eslint;
        let Some(kind) = self.perform_check(self.variable_declarator, left, property, is_port_of_oxlint) else {
            return;
        };
        let has_same_name = property.is_called(left);
        // oxlint's port of ESLint's rule points at the value, without its parentheses if the name is another.
        let place = match declaration.init() {
            Some(init) if is_port_of_oxlint && kind == "object" && !has_same_name => init.span(),
            Some(init) if is_port_of_oxlint => init.outer_span(),
            _ => declaration.span(),
        };
        let report = cx.report(place, PREFER_DESTRUCTURING).data("type", type_in_message(kind, cx));
        // Only `let x = a.x` is fixed.
        if can_fix
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
    pub fn check_assignment_expression<'a, R: Rule>(&self, e: Expr<'a>, cx: &Cx<'a, R>) {
        let ExprKind::Assign { op: None, target, value } = e.kind() else {
            return;
        };
        let Some((_, property)) = member_expression(value) else {
            return;
        };
        let (enabled, left) = (self.assignment_expression, target.as_ident());
        // oxlint's port: `enforceForRenamedProperties` is for `a = b[c]` alone, and `a = b["a"]` is reported once more,
        // whatever the options are.
        if cx.language().is_oxlint && R::META.plugin == Plugin::Eslint {
            let (arrays, objects) = match property {
                _ if utils::is_assignment_target(e) => (0, 0),
                Property::Name(name) => (0, usize::from(enabled.object && left == Some(name))),
                Property::Computed(index) => match index.kind() {
                    ExprKind::Template(_) => (0, 0),
                    ExprKind::Number(_) => (usize::from(enabled.array), 0),
                    ExprKind::String(name) => (
                        0,
                        usize::from(self.enforce_for_renamed_properties && enabled.object)
                            + usize::from(left == Some(name)),
                    ),
                    _ => (0, usize::from(self.enforce_for_renamed_properties && enabled.object)),
                },
            };
            for kind in std::iter::repeat_n("Array", arrays).chain(std::iter::repeat_n("Object", objects)) {
                cx.report(e, PREFER_DESTRUCTURING).data("type", kind);
            }
            return;
        }
        if let Some(kind) = self.perform_check(enabled, left, property, false)
            // A default value in a pattern is not an assignment.
            && !utils::is_assignment_target(e)
        {
            cx.report(e, PREFER_DESTRUCTURING).data("type", type_in_message(kind, cx));
        }
    }
}

impl Rule for PreferDestructuring {
    const META: Meta = Meta::eslint("prefer-destructuring", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferDestructuring {
            config: Config::new(options),
            enforce_for_declaration_with_type_annotation: options
                .object(1)
                .bool_or("enforceForDeclarationWithTypeAnnotation", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        let is_enabled = |it: Enabled| it.array || it.object;
        if is_enabled(self.config.variable_declarator) {
            on.var_decls(|rule, declaration, cx| {
                let has_type_annotation = cx.language().is_oxlint && declaration.ty().is_some();
                if !has_type_annotation || rule.enforce_for_declaration_with_type_annotation {
                    rule.config.check_variable_declarator(declaration, cx, !has_type_annotation);
                }
            });
        }
        if is_enabled(self.config.assignment_expression) || file.language().is_oxlint {
            on.exprs([ExprTag::Assign], |rule, e, cx| rule.config.check_assignment_expression(e, cx));
        }
    }
}
