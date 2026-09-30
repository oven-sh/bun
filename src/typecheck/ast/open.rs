// The objects that one binder, one program or one checker makes. They are written through a shared reference.
use crate::ast::ast::PatternAmbientModule;
use crate::ast::file::{IdAllocator, NodeRecord};
use crate::ast::flow::{FlowList, FlowNode};
use crate::ast::ids::{NodeId, OPEN_BIT, SymbolTableId};
use crate::ast::modifierflags::ModifierFlags;
use crate::ast::nodeflags::NodeFlags;
use crate::ast::stable::Arena;
use crate::ast::symbol::{Symbol, SymbolMap};
use crate::core::TextRange;
use crate::internal::Faults;
use std::cell::{Cell, RefCell};

// A node of the store. Its slots are followed by the fields of the binder that its definition has.
#[derive(Clone, Copy, Default, Debug)]
pub(crate) struct OpenNode {
    pub(crate) rec: NodeRecord,
    pub(crate) flags: NodeFlags,
}

#[derive(Clone, Copy, Default, Debug)]
pub(crate) struct OpenList<'a> {
    pub(crate) loc: TextRange,
    pub(crate) nodes: &'a [NodeId],
    pub(crate) modifier_flags: ModifierFlags,
}

// What a binder writes about the nodes and the source file of the file it binds, until the binding ends.
#[derive(Default)]
pub(crate) struct BindOverlay {
    pub(crate) flags: Vec<NodeFlags>,
    pub(crate) late: Vec<u32>,
    pub(crate) symbol_count: isize,
    pub(crate) global_exports: SymbolTableId,
    pub(crate) pattern_ambient_modules: Vec<PatternAmbientModule>,
    pub(crate) common_js_module_indicator: NodeId,
}

pub struct Open<'a> {
    pub arena: &'a Arena,
    pub(crate) ids: &'a IdAllocator,
    pub(crate) nodes: RefCell<Vec<OpenNode>>,
    pub(crate) slots: RefCell<Vec<u32>>,
    pub(crate) lists: RefCell<Vec<OpenList<'a>>>,
    pub(crate) texts: RefCell<Vec<&'a [u8]>>,
    pub(crate) symbols: RefCell<Vec<Symbol<'a>>>,
    // ast.GetSymbolId of an open symbol, 0 until it is asked for.
    pub(crate) symbol_ids: RefCell<Vec<u64>>,
    pub(crate) tables: RefCell<Vec<SymbolMap<'a>>>,
    pub(crate) flow_nodes: RefCell<Vec<FlowNode>>,
    pub(crate) flow_lists: RefCell<Vec<FlowList>>,
    pub(crate) binding: RefCell<Option<BindOverlay>>,
    pub(crate) node_count: Cell<u32>,
    pub(crate) text_count: Cell<u32>,
    pub faults: Faults,
}

impl<'a> Open<'a> {
    // Index 0 of every store is the nil object.
    pub fn new(arena: &'a Arena, ids: &'a IdAllocator) -> Self {
        Self {
            arena,
            ids,
            nodes: RefCell::new(vec![OpenNode::default()]),
            slots: RefCell::new(Vec::new()),
            lists: RefCell::new(vec![OpenList::default()]),
            texts: RefCell::new(vec![b"".as_slice()]),
            symbols: RefCell::new(vec![Symbol::default()]),
            symbol_ids: RefCell::new(vec![0]),
            tables: RefCell::new(vec![SymbolMap::default()]),
            flow_nodes: RefCell::new(vec![FlowNode::default()]),
            flow_lists: RefCell::new(vec![FlowList::default()]),
            binding: RefCell::new(None),
            node_count: Cell::new(0),
            text_count: Cell::new(0),
            faults: Faults::default(),
        }
    }

    // NodeFactory.NodeCount of the factories of the store.
    pub fn node_count(&self) -> u32 {
        self.node_count.get()
    }

    // NodeFactory.TextCount of the factories of the store.
    pub fn text_count(&self) -> u32 {
        self.text_count.get()
    }

    pub fn symbol_count(&self) -> u32 {
        count(&self.symbols)
    }

    pub fn table_count(&self) -> u32 {
        count(&self.tables)
    }

    pub fn flow_node_count(&self) -> u32 {
        count(&self.flow_nodes)
    }
}

// The number of objects of a store, the nil object not counted.
pub(crate) fn count<T>(cell: &RefCell<Vec<T>>) -> u32 {
    match cell.try_borrow() {
        Ok(items) => items.len().saturating_sub(1) as u32,
        Err(_) => 0,
    }
}

// Reads the object at `index`. None when the index names nothing.
pub(crate) fn read<T, R>(
    cell: &RefCell<Vec<T>>,
    index: usize,
    f: impl FnOnce(&T) -> R,
) -> Option<R> {
    if index == 0 {
        return None;
    }
    let items = cell.try_borrow().ok()?;
    items.get(index).map(f)
}

// Writes to the object at `index`. False when the index names nothing.
pub(crate) fn write<T>(cell: &RefCell<Vec<T>>, index: usize, f: impl FnOnce(&mut T)) -> bool {
    if index == 0 {
        return false;
    }
    match cell.try_borrow_mut() {
        Ok(mut items) => match items.get_mut(index) {
            Some(item) => {
                f(item);
                true
            }
            None => false,
        },
        Err(_) => false,
    }
}

// Appends an object and returns its index, 0 when the store is full.
pub(crate) fn push<T>(cell: &RefCell<Vec<T>>, value: T) -> u32 {
    match cell.try_borrow_mut() {
        Ok(mut items) => match u32::try_from(items.len()) {
            Ok(index) if index < OPEN_BIT - 1 => {
                items.push(value);
                index
            }
            _ => 0,
        },
        Err(_) => 0,
    }
}
