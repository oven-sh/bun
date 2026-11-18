//! The types of locals, and which of those without a default have been set.

use super::{Checked, Validator, is};
use crate::error::Error;
use crate::index::GlobalIndex;
use crate::types::ValType;
use crate::types::display::kind_name;
use crate::visitor::VisitVariable;

#[derive(Default)]
pub(super) struct Locals {
    /// No more than the body has bytes, so that many locals in few bytes cost nothing.
    first: Vec<ValType>,
    first_limit: usize,
    /// For the others: the index after the last of a run, and its type.
    runs: Vec<(u32, ValType)>,
    count: u32,
    param_count: u32,
    /// A bit for each local. None is set between functions.
    initialized: Vec<u64>,
    initializations: Vec<u32>,
}

impl Locals {
    pub(super) fn start(&mut self, params: &[ValType], body_size: usize) {
        self.first.clear();
        self.first.extend_from_slice(params);
        self.first_limit = params.len() + body_size;
        self.runs.clear();
        self.count = params.len() as u32;
        self.param_count = self.count;
    }

    pub(super) fn declare(&mut self, count: u32, ty: ValType) {
        self.count += count;
        let end = self.count as usize;
        self.first.resize(end.min(self.first_limit), ty);
        if end > self.first_limit && count != 0 {
            self.runs.push((self.count, ty));
        }
        if !ty.is_defaultable() && self.initialized.len() < end.div_ceil(64) {
            self.initialized.resize(end.div_ceil(64), 0);
        }
    }

    pub(super) fn count(&self) -> u32 {
        self.count
    }

    #[inline(always)]
    fn get(&self, index: u32) -> Result<ValType, Error> {
        match self.first.get(index as usize) {
            Some(&ty) => Ok(ty),
            None => self.get_from_runs(index),
        }
    }

    #[cold]
    #[inline(never)]
    fn get_from_runs(&self, index: u32) -> Result<ValType, Error> {
        let count = self.count;
        ensure!(
            index < count,
            validation,
            "attempt to use unknown local {index}, the number of locals is {count}"
        );
        Ok(self.runs[self.runs.partition_point(|&(end, _)| end <= index)].1)
    }

    #[inline]
    fn is_initialized(&self, index: u32) -> bool {
        index < self.param_count || self.initialized[index as usize / 64] >> (index % 64) & 1 != 0
    }

    #[inline(never)]
    fn initialize(&mut self, index: u32) {
        if !self.is_initialized(index) {
            self.initialized[index as usize / 64] |= 1 << (index % 64);
            self.initializations.push(index);
        }
    }

    #[inline(always)]
    pub(super) fn initialized_height(&self) -> u32 {
        self.initializations.len() as u32
    }

    #[inline(always)]
    pub(super) fn forget_initializations(&mut self, height: u32) {
        if self.initialized_height() > height {
            self.forget_some(height);
        }
    }

    #[inline(never)]
    fn forget_some(&mut self, height: u32) {
        for index in self.initializations.drain(height as usize..) {
            self.initialized[index as usize / 64] &= !(1 << (index % 64));
        }
    }
}

impl Validator<'_> {
    #[inline(always)]
    fn assign_local(&mut self, local: u32) -> Result<ValType, Error> {
        let ty = self.locals.get(local)?;
        if !ty.is_defaultable() {
            self.locals.initialize(local);
        }
        Ok(ty)
    }

    #[inline(never)]
    fn pop_for_local(&mut self, ty: ValType) -> Checked {
        let value = self.pop("set_local")?;
        ensure!(
            self.fits(value, ty),
            validation,
            "set_local to type {value} expected {ty}"
        );
        Ok(())
    }

    #[inline(never)]
    fn select_untyped(&mut self) -> Checked {
        let condition = self.pop("select condition")?;
        let second = self.pop("select zero")?;
        let first = self.pop("select non-zero")?;
        let known = if first == ValType::UNKNOWN {
            second
        } else {
            first
        };
        ensure!(
            !known.is_ref(),
            parse,
            "can't use ref-types with unannotated select"
        );
        ensure!(
            is(condition, ValType::I32),
            validation,
            "select condition must be i32, got {condition}"
        );
        ensure!(
            is(second, known),
            validation,
            "select result types must match, got {first} and {second}"
        );
        self.push(known)
    }

    #[inline(never)]
    fn select_typed(&mut self, ty: ValType) -> Checked {
        let condition = self.pop("select condition")?;
        let second = self.pop("select zero")?;
        let first = self.pop("select non-zero")?;
        ensure!(
            is(condition, ValType::I32),
            validation,
            "select condition must be i32, got {condition}"
        );
        for value in [first, second] {
            ensure!(
                self.fits(value, ty),
                validation,
                "select result types must match, got {value} and {ty}"
            );
        }
        self.push_loaded(ty)
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitVariable for Validator<'_> {
    #[inline(always)]
    fn drop_(&mut self) -> Checked {
        self.pop("can't drop on empty stack")?;
        Ok(())
    }

    #[inline(always)]
    fn select(&mut self, ty: Option<ValType>) -> Checked {
        match ty {
            Some(ty) => self.select_typed(ty),
            None => self.select_untyped(),
        }
    }

    #[inline(always)]
    fn local_get(&mut self, local: u32) -> Checked {
        let ty = self.locals.get(local)?;
        ensure!(
            ty.is_defaultable() || self.locals.is_initialized(local),
            validation,
            "non-defaultable function local {local} is accessed before initialization"
        );
        self.push(ty)
    }

    #[inline(always)]
    fn local_set(&mut self, local: u32) -> Checked {
        let ty = self.assign_local(local)?;
        if self.top() == Some(&mut [ty]) {
            self.height -= 1;
            return Ok(());
        }
        self.pop_for_local(ty)
    }

    #[inline(always)]
    fn local_tee(&mut self, local: u32) -> Checked {
        let ty = self.assign_local(local)?;
        if self.top() == Some(&mut [ty]) {
            return Ok(());
        }
        ensure!(
            self.has(1),
            parse,
            "can't tee_local on empty expression stack"
        );
        self.pop_for_local(ty)?;
        self.push(ty)
    }

    #[inline(always)]
    fn global_get(&mut self, global: GlobalIndex) -> Checked {
        self.push_loaded(self.header.global(global).ty)
    }

    #[inline(always)]
    fn global_set(&mut self, index: GlobalIndex) -> Checked {
        let global = self.header.global(index);
        ensure!(
            global.mutable,
            validation,
            "set_global {index} is immutable"
        );
        let (value, ty) = (self.pop("set_global value")?, global.ty);
        ensure!(
            self.fits(value, ty),
            validation,
            "set_global {index} with type {} with a variable of type {}",
            kind_name(ty),
            kind_name(value)
        );
        Ok(())
    }
}
