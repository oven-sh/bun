//! What a function is translated to.

use core::slice;
use std::sync::OnceLock;

use bun_engine_wasm_format::OutOfMemory;
use bun_engine_wasm_runtime::Module;
use bun_engine_wasm_runtime::interpreted::Site;

use crate::handlers::Handlers;
use crate::machine::Handler;

/// The operands of an instruction, or some of them, and what runs the one that follows. So a jump goes by the record
/// before its target. The first of a function is there for that alone, and has the size of the frame in `imm`.
///
/// An instruction with one result has its slot in `a`.
#[derive(Clone, Copy)]
#[repr(C)]
pub(crate) struct Op {
    pub(crate) a: u16,
    pub(crate) b: u16,
    pub(crate) imm: u32,
    pub(crate) next: Handler,
}

impl Op {
    /// The low half of `imm`.
    #[inline(always)]
    pub(crate) fn c(&self) -> u16 {
        self.imm as u16
    }

    /// The high half.
    #[inline(always)]
    pub(crate) fn d(&self) -> u16 {
        (self.imm >> 16) as u16
    }

    /// `a` and `b` as one.
    #[inline(always)]
    pub(crate) fn low(&self) -> u32 {
        u32::from(self.a) | u32::from(self.b) << 16
    }

    pub(crate) fn set_low(&mut self, low: u32) {
        (self.a, self.b) = (low as u16, (low >> 16) as u16);
    }

    #[inline(always)]
    pub(crate) fn whole(&self) -> u64 {
        u64::from(self.low()) | u64::from(self.imm) << 32
    }
}

/// The records from that of the next instruction on.
#[derive(Clone)]
pub(crate) struct Pc<'a>(slice::Iter<'a, Op>);

impl<'a> Pc<'a> {
    #[inline(always)]
    pub(crate) fn at(ops: &'a [Op], index: usize) -> Option<Self> {
        Some(Self(ops.get(index..)?.iter()))
    }

    /// The record with that index, and what follows it.
    #[inline(always)]
    pub(crate) fn after(ops: &'a [Op], index: usize) -> Option<(&'a Op, Self)> {
        let mut rest = ops.iter();
        Some((rest.nth(index)?, Self(rest)))
    }

    #[inline(always)]
    pub(crate) fn take(&mut self) -> Option<&'a Op> {
        self.0.next()
    }

    #[inline(always)]
    pub(crate) fn peek(&self, distance: usize) -> Option<&'a Op> {
        self.0.as_slice().get(distance)
    }

    #[inline(always)]
    pub(crate) fn site(&self) -> Site {
        self.0.as_slice().as_ptr().addr()
    }
}

/// That of the last record of the instruction before the site.
pub(crate) fn index_before(ops: &[Op], site: Site) -> usize {
    (site.wrapping_sub(ops.as_ptr().addr()) / size_of::<Op>()).wrapping_sub(1)
}

pub(crate) struct Code {
    pub(crate) ops: Box<[Op]>,
    pub(crate) handlers: Option<Box<Handlers>>,
}

impl Code {
    pub(crate) fn size_in_bytes(&self) -> usize {
        size_of_val(&*self.ops) + self.handlers.as_ref().map_or(0, |it| it.size_in_bytes())
    }
}

/// By the index of the function. Imports have none.
pub(crate) type Functions = [OnceLock<Code>];

pub(crate) fn existing_functions(module: &Module) -> Option<&Functions> {
    let functions = module.interpreted().get()?.downcast_ref::<Box<Functions>>();
    functions.map(|it| &**it)
}

#[cold]
pub(crate) fn make_functions(module: &Module) -> Result<&Functions, OutOfMemory> {
    let mut functions = Vec::new();
    functions.try_reserve_exact(module.funcs().len())?;
    functions.resize_with(module.funcs().len(), OnceLock::<Code>::new);
    let _ = (module.interpreted()).set(Box::new(functions.into_boxed_slice()));
    Ok(existing_functions(module).expect("only this sets it"))
}
