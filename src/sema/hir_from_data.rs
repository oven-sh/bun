mod builder;

use crate::atom::{Atom, Interner};
use crate::hir::{ExprId, File};
use crate::session::Arena;

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum DataValue<'a> {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(Atom),
    BigInt(Atom),
    Array(&'a [DataValue<'a>]),
    Object(&'a [(Atom, DataValue<'a>)]),
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum DataModule<'a> {
    Value {
        default: &'a DataValue<'a>,
        exports_keys: bool,
    },
    RuntimeRequire {
        specifier: Atom,
        loader_type: Option<Atom>,
        member: Option<Atom>,
    },
    NativeAddon {
        path: Atom,
    },
    Database {
        path: Atom,
        is_embedded: bool,
    },
    Page,
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub enum HostValue<'s> {
    Data(&'s DataValue<'s>),
    Deferred,
}

pub struct DataModuleTree<'s> {
    pub file: File<'s>,
    pub host_values: &'s [(ExprId, HostValue<'s>)],
}

pub fn module_from_data<'s>(
    module: &DataModule<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> DataModuleTree<'s> {
    builder::build(module, atoms, arena)
}
