use bun_lint::prelude::*;

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
            cx.report(stmt, UNEXPECTED_LABEL);
        }
    }

    fn check_jump<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (name, message) = match stmt.kind() {
            StmtKind::Break(Some(name)) => (name, UNEXPECTED_LABEL_IN_BREAK),
            StmtKind::Continue(Some(name)) => (name, UNEXPECTED_LABEL_IN_CONTINUE),
            _ => return,
        };
        let target = Node::Stmt(stmt).ancestors().find_map(|it| match it.as_stmt()?.kind() {
            StmtKind::Labeled { label, body } if label == name => Some(body),
            _ => None,
        });
        if !target.is_some_and(|body| self.allows(body)) {
            cx.report(stmt, message);
        }
    }
}

impl Rule for NoLabels {
    const META: Meta = Meta::eslint("no-labels", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoLabels {
            allow_loop: object.bool_or("allowLoop", false),
            allow_switch: object.bool_or("allowSwitch", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Labeled], Self::check_labeled);
        on.stmts([StmtTag::Break, StmtTag::Continue], Self::check_jump);
    }
}
