use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

/// Disallow labeled statements.
pub struct NoLabels {
    allow_loop: bool,
    allow_switch: bool,
}

const UNEXPECTED_LABEL: Message = Message::new("unexpectedLabel", "Unexpected labeled statement.");
const UNEXPECTED_LABEL_IN_BREAK: Message =
    Message::new("unexpectedLabelInBreak", "Unexpected label in break statement.");
const UNEXPECTED_LABEL_IN_CONTINUE: Message =
    Message::new("unexpectedLabelInContinue", "Unexpected label in continue statement.");

/// Where a labeled statement, a `break` or a `continue` is reported. oxlint points at the label.
fn place(stmt: Stmt) -> Span {
    match stmt.label().filter(|_| stmt.file().language().is_oxlint) {
        Some(label) => label.span(),
        None => stmt.span(),
    }
}

impl NoLabels {
    /// Whether a label on `body` is allowed.
    fn allows(&self, body: Stmt) -> bool {
        match body.tag() {
            StmtTag::Switch => self.allow_switch,
            _ if body.is_loop() => self.allow_loop,
            _ => false,
        }
    }

    fn check_labeled<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::Labeled { body, .. } = stmt.kind()
            && !self.allows(body)
        {
            cx.report(place(stmt), UNEXPECTED_LABEL);
        }
    }

    fn check_jump<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (name, message) = match stmt.kind() {
            StmtKind::Break(Some(name)) => (name, UNEXPECTED_LABEL_IN_BREAK),
            StmtKind::Continue(Some(name)) => (name, UNEXPECTED_LABEL_IN_CONTINUE),
            _ => return,
        };
        let is_allowed = cx.state.get(&name).and_then(|around| around.last());
        if is_allowed != Some(&true) {
            cx.report(place(stmt), message);
        }
    }

    /// In source order: before (`is_entered`) and after what is in a labeled statement, and at a `break` or a `continue`.
    fn visit<'a>(&self, node: Node<'a>, is_entered: bool, cx: &mut Cx<'a, Self>) {
        let Node::Stmt(stmt) = node else {
            return;
        };
        match stmt.kind() {
            StmtKind::Labeled { label, body } if is_entered => cx.state.entry(label).or_default().push(self.allows(body)),
            StmtKind::Labeled { label, .. } => {
                cx.state.get_mut(&label).and_then(Vec::pop);
            }
            _ => self.check_jump(stmt, cx),
        }
    }
}

impl Rule for NoLabels {
    const META: Meta = Meta::eslint("no-labels", Kind::Suggestion);
    const ON: On = On::new()
        .stmts(&[StmtTag::Labeled, StmtTag::Break, StmtTag::Continue])
        .enter(NodeTags::new().stmts(&[StmtTag::Labeled, StmtTag::Break, StmtTag::Continue]))
        .exit(NodeTags::new().stmts(&[StmtTag::Labeled]));
    /// For each name, whether the labels of that name around the current statement are allowed, the innermost last.
    type State<'a> = FxHashMap<Name<'a>, Vec<bool>>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoLabels {
            allow_loop: object.bool_or("allowLoop", false),
            allow_switch: object.bool_or("allowSwitch", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(FxHashMap::default())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::Labeled => self.check_labeled(stmt, cx),
            // Whatever has the label.
            _ if !self.allow_loop && !self.allow_switch => self.check_jump(stmt, cx),
            _ => {}
        }
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if self.allow_loop || self.allow_switch {
            self.visit(node, true, cx);
        }
    }

    fn exit<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if self.allow_loop || self.allow_switch {
            self.visit(node, false, cx);
        }
    }
}
