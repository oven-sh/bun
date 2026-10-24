use super::children::{TreeNode, push_children};
use crate::bind::{
    Binding, BindingInitializer, BindingKind, BindingStability, Bound, Decl, SymbolId,
};
use crate::hir::{ExprId, ExprKind, File, FnId, StmtKind};
use crate::util::{FxHashMap, SharedSort};

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
    place_of_variable_read: FxHashMap<ExprId, Place>,
    first_run: Vec<u32>,
}

struct Walk<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    order: RunOrder,
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

    fn visit_name(&mut self, name: ExprId, place: Place) {
        let Binding::Symbol(symbol) = self.bound.binding(name) else {
            return;
        };
        match self.bound.binding_kind(symbol) {
            BindingKind::Var => {
                self.order.place_of_variable_read.insert(name, place);
            }
            BindingKind::Function => match self.find_declared_function(symbol) {
                Some(function) => self.can_run_at(function, place),
                None => self.order.first_run.fill(0),
            },
            _ => {}
        }
    }

    fn visit_declaration(&mut self, function: FnId) {
        let symbol = self.bound.declared_symbol(Decl::Fn(function));
        let stability = self.bound.binding_stability(symbol);
        self.is_declared[function.idx()] = stability != BindingStability::ContainerMember;
        if self.bound.is_visible_to_eval(symbol) {
            self.order.first_run[function.idx()] = 0;
        }
    }

    fn visit_statement_of_body(&mut self, index: u32, statement: TreeNode) {
        let hir = self.hir;
        let mut stack = vec![(statement, Place::Statement(index))];
        let mut children = Vec::new();
        while let Some((node, place)) = stack.pop() {
            let mut place_of_children = place;
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
                    place_of_children = Place::Function(function);
                }
                TreeNode::Expr(e) => {
                    if let ExprKind::Ident(_) = hir[e].kind {
                        self.visit_name(e, place);
                    }
                }
                TreeNode::Class(_) | TreeNode::Pattern(_) => {}
            }
            push_children(hir, node, &mut children);
            stack.extend(children.drain(..).map(|child| (child, place_of_children)));
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

impl RunOrder {
    pub(super) fn new<'s>(hir: &File<'s>, bound: &Bound<'s>) -> RunOrder {
        let mut walk = Walk {
            hir,
            bound,
            order: RunOrder {
                statement_of_initializer: FxHashMap::default(),
                place_of_variable_read: FxHashMap::default(),
                first_run: vec![NEVER; hir.fns.len()],
            },
            is_declared: vec![false; hir.fns.len()],
            function_of_symbol: FxHashMap::default(),
            reached_from: Vec::new(),
        };
        for (index, statement) in (0..).zip(hir.ids(hir.body)) {
            if let StmtKind::Var(declarations) = hir[statement].kind {
                let initializers = declarations.iter().filter_map(|it| hir[it].init.some());
                let initializers = initializers.map(|initializer| (initializer, index));
                walk.order.statement_of_initializer.extend(initializers);
            }
            walk.visit_statement_of_body(index, TreeNode::Stmt(statement));
        }
        walk.spread_to_reached_functions();
        walk.order
    }

    pub(super) fn order_of_read(&self, read: ExprId, initializer: ExprId) -> ReadOrder {
        let initialized = self.statement_of_initializer.get(&initializer);
        let place = self.place_of_variable_read.get(&read);
        match (initialized, place) {
            (Some(&initialized), Some(&Place::Statement(statement)))
                if statement >= initialized =>
            {
                ReadOrder::Behind
            }
            (Some(&initialized), Some(&Place::Function(function)))
                if self.first_run[function.idx()] > initialized =>
            {
                ReadOrder::BehindUnlessCalledByImporter
            }
            _ => ReadOrder::MayComeFirst,
        }
    }
}
