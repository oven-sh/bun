use super::children::{TreeNode, push_children};
use crate::bind::{Binding, BindingKind, Bound, Decl, SymbolId};
use crate::hir::{
    ExprId, ExprKind, File, Flags, PatKind, StmtId, StmtKind, is_moved_to_file_start,
};
use crate::util::{FxHashMap, FxHashSet};
use std::cell::OnceCell;

const RUNS_LATER: u32 = u32::MAX;

pub(super) struct RunOrder {
    statement_of_initializer: FxHashMap<ExprId, u32>,
    statement_of_read: OnceCell<Vec<u32>>,
    first_function_use: OnceCell<u32>,
}

/// Finds the first statement of a file that may call one of the file's functions, or pass one to
/// other code. No function of the file runs before it.
struct FunctionUses<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    exported: FxHashSet<SymbolId>,
    variables_with_functions: FxHashSet<SymbolId>,
}

impl<'a, 's> FunctionUses<'a, 's> {
    fn find_first(hir: &'a File<'s>, bound: &'a Bound<'s>) -> u32 {
        let mut uses = FunctionUses {
            hir,
            bound,
            exported: exported_symbols(hir, bound),
            variables_with_functions: FxHashSet::default(),
        };
        // An import cycle may call it before the first statement: plain Bun also moves classes and
        // default exports up.
        let mut statements = hir.ids(hir.body);
        if uses.exported.iter().any(|&it| uses.holds_function(it))
            || statements.any(|it| uses.is_default_function(it))
        {
            return 0;
        }
        let mut statements = (1..).zip(hir.ids(hir.body));
        statements
            .find(|&(_, statement)| uses.has_use(statement))
            .map_or(u32::MAX, |(number, _)| number)
    }

    fn is_default_function(&self, statement: StmtId) -> bool {
        let StmtKind::ExportDefault(value) = self.hir[statement].kind else {
            return false;
        };
        let mut stack = vec![TreeNode::Expr(value)];
        while let Some(node) = stack.pop() {
            if let TreeNode::Function(_) | TreeNode::Class(_) = node {
                return true;
            }
            push_children(self.hir, node, &mut stack);
        }
        false
    }

    fn has_use(&mut self, statement: StmtId) -> bool {
        let hir = self.hir;
        let mut stack = Vec::new();
        match hir[statement].kind {
            StmtKind::Fn(_) => {}
            StmtKind::Class(_) => return !is_moved_to_file_start(hir, statement),
            StmtKind::Var(declarations) => {
                for declaration in declarations.iter().map(|it| &hir[it]) {
                    let init = declaration
                        .init
                        .some()
                        .map(|it| hir.skip_type_assertions(it));
                    if let (PatKind::Ident(_), Some(init)) = (hir[declaration.pat].kind, init)
                        && matches!(hir[init].kind, ExprKind::Fn(_))
                    {
                        let symbol = self.bound.declared_symbol(Decl::Var(declaration.pat));
                        if self.exported.contains(&symbol) {
                            return true;
                        }
                        self.variables_with_functions.insert(symbol);
                        continue;
                    }
                    stack.push(TreeNode::Pattern(declaration.pat));
                    stack.extend(declaration.init.some().map(TreeNode::Expr));
                }
            }
            _ => stack.push(TreeNode::Stmt(statement)),
        }
        while let Some(node) = stack.pop() {
            let may_run_function = match node {
                TreeNode::Function(_) | TreeNode::Class(_) => true,
                TreeNode::Expr(e) => self.may_run_function(e),
                TreeNode::Stmt(stmt) => may_run_function_unnamed(hir, stmt),
                TreeNode::Pattern(_) => false,
            };
            if may_run_function {
                return true;
            }
            push_children(hir, node, &mut stack);
        }
        false
    }

    fn may_run_function(&self, e: ExprId) -> bool {
        match self.hir[e].kind {
            ExprKind::Ident(_) => self.names_function(e),
            ExprKind::Call(_) => self.bound.eval_scope(e).is_some(),
            // The factory of an element is called without a mention of it.
            ExprKind::Jsx(_)
            | ExprKind::JsxText(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::Super
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::Yield { .. }
            | ExprKind::NewTarget(_)
            | ExprKind::Missing => true,
            ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::New(_)
            | ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::ImportMeta => false,
        }
    }

    fn names_function(&self, identifier: ExprId) -> bool {
        match self.bound.binding(identifier) {
            Binding::Symbol(symbol) => self.holds_function(symbol),
            Binding::Free | Binding::Arguments(_) | Binding::CommonJs(_) => false,
        }
    }

    fn holds_function(&self, symbol: SymbolId) -> bool {
        let kind = self.bound.binding_kind(symbol);
        matches!(kind, BindingKind::Function | BindingKind::Class)
            || self.variables_with_functions.contains(&symbol)
            || (self.bound.symbol(symbol).decls.iter())
                .any(|it| matches!(it, Decl::Fn(_) | Decl::Class(_)))
    }
}

fn may_run_function_unnamed(hir: &File<'_>, statement: StmtId) -> bool {
    match hir[statement].kind {
        StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::With { .. }
        | StmtKind::ImportEquals(_)
        | StmtKind::Fn(_)
        | StmtKind::Class(_)
        | StmtKind::Return(_) => true,
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Expr(_)
        | StmtKind::Var(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::If { .. }
        | StmtKind::For { .. }
        | StmtKind::ForIn { .. }
        | StmtKind::ForOf { .. }
        | StmtKind::While { .. }
        | StmtKind::DoWhile { .. }
        | StmtKind::Block(_)
        | StmtKind::Switch { .. }
        | StmtKind::Try { .. }
        | StmtKind::Throw(_)
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Labeled { .. }
        | StmtKind::Import(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportDefault(_)
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_)
        | StmtKind::Directive { .. } => false,
    }
}

fn exported_symbols(hir: &File<'_>, bound: &Bound<'_>) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::default();
    if !hir.has_module_syntax {
        return symbols;
    }
    for &(_, exported) in bound.table(bound.symbol(bound.file_symbol).exports) {
        symbols.insert(exported);
        for &declaration in bound.symbol(exported).decls {
            match declaration {
                Decl::ExportSpec(spec) => {
                    if let Binding::Symbol(local) = bound.exported_binding(spec) {
                        symbols.insert(local);
                    }
                }
                Decl::Var(_) | Decl::Fn(_) | Decl::Class(_) => {
                    symbols.insert(bound.declared_symbol(declaration));
                }
                _ => {}
            }
        }
    }
    symbols
}

fn find_statements_of_reads(hir: &File<'_>) -> Vec<u32> {
    let mut statement_of_read = vec![0; hir.exprs.len()];
    let mut stack = Vec::new();
    for (number, statement) in (1..).zip(hir.ids(hir.body)) {
        stack.push(TreeNode::Stmt(statement));
        while let Some(node) = stack.pop() {
            match node {
                TreeNode::Function(_) => continue,
                TreeNode::Expr(e) if statement_of_read[e.idx()] == RUNS_LATER => {
                    statement_of_read[e.idx()] = 0;
                    continue;
                }
                TreeNode::Expr(e) if matches!(hir[e].kind, ExprKind::Ident(_)) => {
                    statement_of_read[e.idx()] = number;
                }
                TreeNode::Class(class) => {
                    for member in hir[class].members.iter().map(|member| &hir[member]) {
                        if member.init.is_some() && !member.flags.contains(Flags::STATIC) {
                            statement_of_read[member.init.idx()] = RUNS_LATER;
                        }
                    }
                }
                TreeNode::Expr(_) | TreeNode::Stmt(_) | TreeNode::Pattern(_) => {}
            }
            push_children(hir, node, &mut stack);
        }
    }
    statement_of_read
}

impl RunOrder {
    pub(super) fn new(hir: &File<'_>) -> RunOrder {
        let mut statement_of_initializer = FxHashMap::default();
        for (number, statement) in (1..).zip(hir.ids(hir.body)) {
            if let StmtKind::Var(declarations) = hir[statement].kind {
                let initializers = declarations.iter().filter_map(|it| hir[it].init.some());
                statement_of_initializer.extend(initializers.map(|it| (it, number)));
            }
        }
        RunOrder {
            statement_of_initializer,
            statement_of_read: OnceCell::new(),
            first_function_use: OnceCell::new(),
        }
    }

    /// Like `is_read_behind`, for a read in a function too.
    pub(super) fn is_initialized_at<'s>(
        &self,
        hir: &File<'s>,
        bound: &Bound<'s>,
        read: ExprId,
        initializer: ExprId,
    ) -> bool {
        let Some(&initialized) = self.statement_of_initializer.get(&initializer) else {
            return false;
        };
        let find = || find_statements_of_reads(hir);
        match self.statement_of_read.get_or_init(find)[read.idx()] {
            0 => {
                let find = || FunctionUses::find_first(hir, bound);
                initialized < *self.first_function_use.get_or_init(find)
            }
            statement => statement >= initialized,
        }
    }

    pub(super) fn is_read_behind(&self, hir: &File<'_>, read: ExprId, initializer: ExprId) -> bool {
        let Some(&initialized) = self.statement_of_initializer.get(&initializer) else {
            return false;
        };
        let find = || find_statements_of_reads(hir);
        self.statement_of_read.get_or_init(find)[read.idx()] >= initialized
    }
}
