use crate::bind::{Bound, Parent};
use crate::hir::{File, Flags, FnBody, PatId, PatKind, StmtId, StmtKind, VarDeclId, VarKind};
use crate::module_format::find_scope_below_file;

/// What `bun run` prints of a statement that never runs. `should_keep_stmt_in_dead_control_flow` of the parser decides it.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Left {
    Nothing,
    /// Only the names of `var` declarations, which the parser declares at the end of the file.
    VarsAtEndOfFile,
    /// A statement where it stands. An `if` around it stays, with its test.
    InPlace,
}

/// What `bun run` prints of the branch of an `if` that never runs.
#[derive(Copy, Clone)]
pub struct NeverRun<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
}

impl<'a, 's> NeverRun<'a, 's> {
    pub fn new(hir: &'a File<'s>, bound: &'a Bound<'s>) -> NeverRun<'a, 's> {
        NeverRun { hir, bound }
    }

    /// Whether `bun run` prints nothing of this branch of an `if` that never runs, and declares nothing for it.
    #[inline]
    pub fn prints_nothing(&self, statement: StmtId) -> bool {
        self.left(statement) == Left::Nothing
    }

    /// Whether `bun run` prints an `if` for this branch of it that never runs. It then prints the test as well.
    #[inline]
    pub fn keeps_its_if(&self, statement: StmtId) -> bool {
        self.left(statement) == Left::InPlace
    }

    fn left(&self, statement: StmtId) -> Left {
        let hir = self.hir;
        let Some(node) = hir.stmts.get(statement.idx()) else {
            return Left::Nothing;
        };
        if hir.is_erased_statement(statement) {
            return Left::Nothing;
        }
        match node.kind {
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Directive { .. }
            | StmtKind::Expr(_)
            | StmtKind::Class(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_) => Left::Nothing,
            StmtKind::Var(declarations) => {
                let binds_a_name = |declaration: VarDeclId| {
                    let declaration = hir[declaration];
                    declaration.kind == VarKind::Var && binds_a_name(hir, declaration.pat)
                };
                let assigns = |declaration: VarDeclId| hir[declaration].init.is_some();
                match declarations.iter().any(binds_a_name) {
                    false => Left::Nothing,
                    true if !self.is_moved_to_end_of_file(statement) => Left::InPlace,
                    // `s_for`: without a value to assign the `var` stays in the head. `s_for_in` and `s_for_of` always move it.
                    true if !declarations.iter().any(assigns) && self.is_init_of_for(statement) => {
                        Left::InPlace
                    }
                    true => Left::VarsAtEndOfFile,
                }
            }
            StmtKind::Fn(_) => match self.becomes_let(statement) {
                true => Left::Nothing,
                false => Left::InPlace,
            },
            StmtKind::Block(list) => self.most_left(hir.ids(list)),
            StmtKind::If { yes, no, .. } => self.most_left([yes, no].into_iter()),
            StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. }
            | StmtKind::Labeled { body, .. } => self.left(body),
            StmtKind::For {
                init: head, body, ..
            }
            | StmtKind::ForIn {
                left: head, body, ..
            }
            | StmtKind::ForOf {
                left: head, body, ..
            } => self.most_left([head, body].into_iter()),
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => self.most_left([block, handler, finalizer].into_iter()),
            StmtKind::Switch { .. } | StmtKind::With { .. } => Left::InPlace,
            // No file that `bun run` loads holds one of these below an `if`.
            StmtKind::Module(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => Left::InPlace,
        }
    }

    fn most_left(&self, statements: impl Iterator<Item = StmtId>) -> Left {
        let mut most = Left::Nothing;
        for statement in statements {
            most = most.max(self.left(statement));
            if most == Left::InPlace {
                break;
            }
        }
        most
    }

    /// `maybe_relocate_vars_to_top_level`: a `var` of the file below a scope is declared at the end of the file.
    fn is_moved_to_end_of_file(&self, statement: StmtId) -> bool {
        let Some(mut scope) = find_scope_below_file(self.hir, self.bound, statement) else {
            return false;
        };
        loop {
            match self.bound.parent_of_stmt(scope) {
                Parent::Stmt(above) => scope = above,
                Parent::File => return true,
                _ => return false,
            }
        }
    }

    fn is_init_of_for(&self, statement: StmtId) -> bool {
        let Parent::Stmt(above) = self.bound.parent_of_stmt(statement) else {
            return false;
        };
        matches!(self.hir[above].kind, StmtKind::For { init, .. } if init == statement)
    }

    /// Whether `bun run` writes a function of a block, of a label or of an `if` as `let f = function() {}`: `visit_stmts`.
    pub fn becomes_let(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        let Some(StmtKind::Fn(function)) = hir.stmts.get(statement.idx()).map(|it| it.kind) else {
            return false;
        };
        let written = &hir[function];
        let is_plain = matches!(written.body, FnBody::Block(_))
            && !(written.flags).intersects(Flags::ASYNC | Flags::GENERATOR | Flags::AMBIENT);
        is_plain
            && (self.find_scope_of_block_function(statement))
                .is_some_and(|scope| !self.holds_direct_eval(scope))
    }

    /// The text of the scope in which the parser declares a function of a block, of a label or of an `if`.
    fn find_scope_of_block_function(&self, statement: StmtId) -> Option<(u32, u32)> {
        let hir = self.hir;
        let whole = |statement: StmtId| (hir[statement].start, hir[statement].loc.end);
        let Parent::Stmt(above) = self.bound.parent_of_stmt(statement) else {
            return None;
        };
        match hir[above].kind {
            StmtKind::Block(_) => Some(whole(above)),
            StmtKind::If { .. } | StmtKind::Labeled { .. } => Some(whole(statement)),
            _ => None,
        }
    }

    /// With a direct `eval` in its scope the parser leaves the declaration.
    fn holds_direct_eval(&self, (start, end): (u32, u32)) -> bool {
        let hir = self.hir;
        let is_inside = |position: u32| (start..end).contains(&position);
        let mut running = self.bound.runtime.eval_scopes().iter();
        let mut settled = hir.settled_evals.iter();
        running.any(|&(call, _)| is_inside(hir[call].pos))
            || settled.any(|&call| is_inside(hir[hir[call].callee].pos))
    }
}

fn binds_a_name(hir: &File<'_>, pattern: PatId) -> bool {
    match hir[pattern].kind {
        PatKind::Missing => false,
        PatKind::Ident(_) => true,
        PatKind::Object(props) => (props.iter()).any(|prop| binds_a_name(hir, hir[prop].value)),
        PatKind::Array(elements) => {
            (elements.iter()).any(|element| binds_a_name(hir, hir[element].pat))
        }
    }
}
