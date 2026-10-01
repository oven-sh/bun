// The objects that one binder, one program or one checker makes. They are written through a shared reference.
use crate::ast::ast_generated::Def;
use crate::ast::file::{FlowList, FlowNode, IdAllocator};
use crate::ast::flags_generated::{CheckFlags, ModifierFlags, NodeFlags, SymbolFlags};
use crate::ast::kind_generated::Kind;
use crate::tscore::golang::{List, Map, OrderedMap, Text};
use crate::tscore::ids::{NodeId, SymbolId, SymbolTableId};
use crate::tscore::internal::Faults;
use crate::tscore::stable::Arena;
use crate::tscore::text::TextRange;
use std::cell::{Cell, RefCell};

#[derive(Clone, Copy, Default, Debug)]
pub struct OpenNode<'a> {
    pub loc: TextRange,
    pub parent: NodeId,
    pub flags: NodeFlags,
    pub kind: Kind,
    pub def: Def,
    pub slots: &'a [u32],
    // One word for each LATE_* bit.
    pub late: [u32; 8],
}

#[derive(Clone, Copy, Default, Debug)]
pub struct OpenList<'a> {
    pub loc: TextRange,
    pub nodes: List<'a, NodeId>,
    pub modifier_flags: ModifierFlags,
}

// ast.Symbol as the binder and the checker read it. A symbol of a published file is decoded into this shape.
#[derive(Clone, Copy, Default, Debug)]
pub struct Symbol<'a> {
    pub flags: SymbolFlags,
    pub check_flags: CheckFlags,
    pub name: Text<'a>,
    pub declarations: List<'a, NodeId>,
    pub value_declaration: NodeId,
    pub members: SymbolTableId,
    pub exports: SymbolTableId,
    pub parent: SymbolId,
    pub export_symbol: SymbolId,
}

pub struct Open<'a> {
    pub arena: &'a Arena,
    pub(crate) nodes: RefCell<Vec<OpenNode<'a>>>,
    pub(crate) lists: RefCell<Vec<OpenList<'a>>>,
    pub(crate) texts: RefCell<Vec<Text<'a>>>,
    pub(crate) symbols: RefCell<Vec<Symbol<'a>>>,
    pub(crate) tables: RefCell<Vec<OrderedMap<Text<'a>, SymbolId>>>,
    pub(crate) flow_nodes: RefCell<Vec<FlowNode>>,
    pub(crate) flow_lists: RefCell<Vec<FlowList>>,
    // ast.GetSymbolId: the id of an open symbol by its index, of a symbol of a file by its id.
    pub(crate) open_symbol_ids: RefCell<Vec<u64>>,
    pub(crate) file_symbol_ids: RefCell<Map<u32, u64>>,
    pub(crate) ids: &'a IdAllocator,
    pub(crate) node_count: Cell<u32>,
    pub(crate) text_count: Cell<u32>,
    pub faults: Faults,
}

impl<'a> Open<'a> {
    pub fn new(arena: &'a Arena, ids: &'a IdAllocator) -> Self {
        Self {
            arena,
            nodes: RefCell::new(vec![OpenNode::default()]),
            lists: RefCell::new(vec![OpenList::default()]),
            texts: RefCell::new(vec![b"".as_slice()]),
            symbols: RefCell::new(vec![Symbol::default()]),
            tables: RefCell::new(vec![OrderedMap::default()]),
            flow_nodes: RefCell::new(vec![FlowNode::default()]),
            flow_lists: RefCell::new(vec![FlowList::default()]),
            open_symbol_ids: RefCell::new(vec![0]),
            file_symbol_ids: RefCell::new(Map::make()),
            ids,
            node_count: Cell::new(0),
            text_count: Cell::new(0),
            faults: Faults::default(),
        }
    }
    pub fn node_count(&self) -> u32 {
        self.node_count.get()
    }
    pub fn text_count(&self) -> u32 {
        self.text_count.get()
    }
    pub fn symbol_count(&self) -> u32 {
        count(&self.symbols)
    }
    pub fn flow_node_count(&self) -> u32 {
        count(&self.flow_nodes)
    }
}

pub(crate) fn count<T>(cell: &RefCell<Vec<T>>) -> u32 {
    match cell.try_borrow() {
        Ok(items) => items.len().saturating_sub(1) as u32,
        Err(_) => 0,
    }
}

// Reads a field of the object at `index`. The default when the index names nothing.
pub(crate) fn read<T, R: Default>(
    cell: &RefCell<Vec<T>>,
    index: usize,
    f: impl FnOnce(&T) -> R,
) -> R {
    match cell.try_borrow() {
        Ok(items) => match items.get(index) {
            Some(item) if index != 0 => f(item),
            _ => R::default(),
        },
        Err(_) => R::default(),
    }
}

// Writes to the object at `index`. False when the index names nothing.
pub(crate) fn write<T>(cell: &RefCell<Vec<T>>, index: usize, f: impl FnOnce(&mut T)) -> bool {
    match cell.try_borrow_mut() {
        Ok(mut items) => match items.get_mut(index) {
            Some(item) if index != 0 => {
                f(item);
                true
            }
            _ => false,
        },
        Err(_) => false,
    }
}

// Appends an object and returns its index, 0 when the store is full.
pub(crate) fn push<T>(cell: &RefCell<Vec<T>>, value: T) -> u32 {
    match cell.try_borrow_mut() {
        Ok(mut items) => match u32::try_from(items.len()) {
            Ok(index) if index < crate::tscore::ids::OPEN_BIT => {
                items.push(value);
                index
            }
            _ => 0,
        },
        Err(_) => 0,
    }
}

impl Open<'_> {
    pub fn table_count(&self) -> u32 {
        count(&self.tables)
    }
}
