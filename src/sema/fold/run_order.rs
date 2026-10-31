use super::children::{TreeNode, push_children};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, Decl, ImplicitReference,
    SymbolId,
};
use crate::hir::{ExprId, ExprKind, File, FnId, NodeData, StmtKind};
use crate::util::{FxHashMap, SharedSort};
use std::cell::OnceCell;

const NEVER: u32 = u32::MAX;

#[derive(Copy, Clone)]
enum Place {
    Statement(u32),
    Function(FnId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum ReadOrder {
    MayComeFirst,
    Behind,
    BehindUnlessCalledByImporter,
}

pub(super) struct RunOrder {
    statement_of_initializer: FxHashMap<ExprId, u32>,
    /// Found when somebody asks about a variable that a statement of the body of the file initializes. Most variables belong to functions.
    places: OnceCell<Places>,
}

struct Places {
    /// By expression. 0: no read of a variable. Odd: in a statement of the body. Even: in a function.
    place_of_variable_read: Vec<u32>,
    first_run: Vec<u32>,
}

impl Places {
    fn note_variable_read(&mut self, read: ExprId, place: Place) {
        self.place_of_variable_read[read.idx()] = match place {
            Place::Statement(statement) => 2 * statement + 1,
            Place::Function(function) => 2 * function.0 + 2,
        };
    }

    fn place_of_variable_read(&self, read: ExprId) -> Option<Place> {
        match self.place_of_variable_read[read.idx()] {
            0 => None,
            place if place % 2 == 1 => Some(Place::Statement(place / 2)),
            place => Some(Place::Function(FnId(place / 2 - 1))),
        }
    }
}

struct Walk<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    /// `Bound::define_heads`, in the order of their roots.
    define_heads: &'a [ImplicitReference],
    order: Places,
    is_declared: Vec<bool>,
    function_of_symbol: FxHashMap<SymbolId, Option<FnId>>,
    reached_from: Vec<(FnId, FnId)>,
}

impl Walk<'_, '_> {
    fn can_run_at(&mut self, function: FnId, place: Place) {
        match place {
            Place::Statement(statement) => {
                let first_run = &mut self.order.first_run[function.idx()];
                *first_run = statement.min(*first_run);
            }
            Place::Function(outer) => self.reached_from.push((outer, function)),
        }
    }

    fn find_declared_function(&mut self, symbol: SymbolId) -> Option<FnId> {
        let (hir, bound) = (self.hir, self.bound);
        let found = self.function_of_symbol.entry(symbol);
        *found.or_insert_with(|| match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Function(function) => Some(function),
            _ => None,
        })
    }

    fn visit_function_name(&mut self, symbol: SymbolId, place: Place) {
        match self.find_declared_function(symbol) {
            Some(function) => self.can_run_at(function, place),
            None => self.order.first_run.fill(0),
        }
    }

    fn visit_name(&mut self, name: ExprId, place: Place) {
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return;
        };
        match self.bound.binding_kind(symbol) {
            BindingKind::Var => self.order.note_variable_read(name, place),
            BindingKind::Function => self.visit_function_name(symbol, place),
            _ => {}
        }
    }

    // A define may put the name of a function at `root`. The walk runs while the file is folded, so every record there counts, applied or not.
    fn visit_define_heads(&mut self, root: ExprId, place: Place) {
        let heads = self.define_heads;
        let is_in_front = |head: &ImplicitReference| match head.node {
            NodeData::Expr(recorded) => recorded < root,
            _ => false,
        };
        let at_root = heads[heads.partition_point(is_in_front)..].iter();
        for head in at_root.take_while(|head| head.node == NodeData::Expr(root)) {
            if let Binding::Symbol(symbol) = head.binding
                && self.bound.binding_kind(symbol) == BindingKind::Function
            {
                self.visit_function_name(symbol, place);
            }
        }
    }

    // Inlined by force. `visit_body` has two copies, and with two callers this would be a call in the one that a file without a define head runs.
    #[inline(always)]
    fn visit_declaration(&mut self, function: FnId) {
        let symbol = self.bound.declared_symbol(Decl::Fn(function));
        let stability = self.bound.binding_stability(symbol);
        self.is_declared[function.idx()] = stability != BindingStability::ContainerMember;
        if self.bound.is_visible_to_eval(symbol) {
            self.order.first_run[function.idx()] = 0;
        }
    }

    fn visit_body<const HAS_DEFINE_HEADS: bool>(&mut self) {
        let hir = self.hir;
        // All of `stack` is in one place. What a function holds waits in `functions` until the place around it is through.
        let mut stack = Vec::new();
        let mut functions = Vec::new();
        for (index, statement) in (0..).zip(hir.ids(hir.body)) {
            let mut place = Place::Statement(index);
            stack.push(TreeNode::Stmt(statement));
            loop {
                while let Some(node) = stack.pop() {
                    match node {
                        TreeNode::Stmt(statement) => {
                            if let StmtKind::Fn(function) = hir[statement].kind {
                                self.visit_declaration(function);
                            }
                        }
                        TreeNode::Function(function) => {
                            if !self.is_declared[function.idx()] {
                                self.can_run_at(function, place);
                            }
                            functions.push(function);
                            continue;
                        }
                        TreeNode::Expr(e) => {
                            if let ExprKind::Ident(_) = hir[e].kind {
                                self.visit_name(e, place);
                            }
                            if HAS_DEFINE_HEADS {
                                self.visit_define_heads(e, place);
                            }
                        }
                        TreeNode::Class(_) | TreeNode::Pattern(_) => {}
                    }
                    push_children(hir, node, &mut stack);
                }
                let Some(function) = functions.pop() else {
                    break;
                };
                place = Place::Function(function);
                push_children(hir, TreeNode::Function(function), &mut stack);
            }
        }
    }

    fn spread_to_reached_functions(&mut self) {
        self.reached_from
            .shared_sort_unstable_by_key(|entry| entry.0);
        let first_run = &mut self.order.first_run;
        let mut changed: Vec<FnId> = (0..first_run.len() as u32)
            .map(FnId)
            .filter(|function| first_run[function.idx()] != NEVER)
            .collect();
        while let Some(outer) = changed.pop() {
            let start = self.reached_from.partition_point(|entry| entry.0 < outer);
            let reached = self.reached_from[start..].iter();
            for &(_, function) in reached.take_while(|entry| entry.0 == outer) {
                if first_run[outer.idx()] < first_run[function.idx()] {
                    first_run[function.idx()] = first_run[outer.idx()];
                    changed.push(function);
                }
            }
        }
    }
}

impl Places {
    fn new<'s>(hir: &File<'s>, bound: &Bound<'s>) -> Places {
        let mut walk = Walk {
            hir,
            bound,
            define_heads: bound.define_heads(),
            order: Places {
                place_of_variable_read: vec![0; hir.exprs.len()],
                first_run: vec![NEVER; hir.fns.len()],
            },
            is_declared: vec![false; hir.fns.len()],
            function_of_symbol: FxHashMap::default(),
            reached_from: Vec::new(),
        };
        // A file without a define head pays this one test, and its walk looks for none at any expression.
        if walk.define_heads.is_empty() {
            walk.visit_body::<false>();
        } else {
            walk.visit_body::<true>();
        }
        walk.spread_to_reached_functions();
        walk.order
    }
}

impl RunOrder {
    pub(super) fn new(hir: &File<'_>) -> RunOrder {
        let mut statement_of_initializer = FxHashMap::default();
        for (index, statement) in (0..).zip(hir.ids(hir.body)) {
            if let StmtKind::Var(declarations) = hir[statement].kind {
                let initializers = declarations.iter().filter_map(|it| hir[it].init.some());
                statement_of_initializer.extend(initializers.map(|it| (it, index)));
            }
        }
        RunOrder {
            statement_of_initializer,
            places: OnceCell::new(),
        }
    }

    pub(super) fn order_of_read<'s>(
        &self,
        hir: &File<'s>,
        bound: &Bound<'s>,
        read: ExprId,
        initializer: ExprId,
    ) -> ReadOrder {
        let Some(&initialized) = self.statement_of_initializer.get(&initializer) else {
            return ReadOrder::MayComeFirst;
        };
        let places = self.places.get_or_init(|| Places::new(hir, bound));
        match places.place_of_variable_read(read) {
            Some(Place::Statement(statement)) if statement >= initialized => ReadOrder::Behind,
            Some(Place::Function(function)) if places.first_run[function.idx()] > initialized => {
                ReadOrder::BehindUnlessCalledByImporter
            }
            _ => ReadOrder::MayComeFirst,
        }
    }
}
