use core::slice;

use super::{Checked, Frame, FrameKind, Validator, is};
use crate::index::{FuncIndex, TableIndex, TagIndex, TypeIndex};
use crate::ops::{BrTable, Catches, Flow};
use crate::types::display::kind_name;
use crate::types::{BlockType, FuncType, HeapType, RefType, TypeKind, ValType};
use crate::visitor::VisitControl;

#[derive(Clone, Copy)]
enum Callee {
    Func(FuncIndex),
    Indirect,
    Ref,
}

impl<'a> Validator<'a> {
    #[inline(always)]
    fn innermost(&mut self) -> &mut Frame {
        self.frames.last_mut().expect("an open block")
    }

    #[inline(always)]
    fn target(&self, label: u32) -> &Frame {
        &self.frames[self.frames.len() - 1 - label as usize]
    }

    fn label_types<'b>(&self, target: &'b Frame) -> &'b [ValType]
    where
        'a: 'b,
    {
        let ty = self.types().block_type(&target.ty);
        match target.kind {
            FrameKind::Loop | FrameKind::Constant => ty.params,
            _ => ty.results,
        }
    }

    #[inline(always)]
    fn open(&mut self, kind: FrameKind, ty: BlockType) -> Checked {
        let params = match ty {
            BlockType::Empty => 0,
            BlockType::Value(result) => {
                self.uses_simd |= result == ValType::V128;
                0
            }
            BlockType::Func(index) => self.check_block_params(index)?,
        };
        self.push_frame(kind, ty, params)
    }

    /// Returns their number.
    #[inline(never)]
    pub(super) fn check_block_params(&mut self, index: TypeIndex) -> Result<usize, crate::Error> {
        self.uses_simd |= self.types().signature_has_v128(index);
        let ty = self.types().func_type(index);
        let (count, available) = (ty.params.len(), self.available());
        if self.top_is(ty.params) {
            return Ok(count);
        }
        ensure!(
            self.has(count),
            validation,
            "Too few values on stack for block. Block expects {count}, but only {available} were present. \
             Block has signature: {ty}"
        );
        for (i, actual, expected) in self.operands(ty.params) {
            ensure!(
                self.fits(actual, expected),
                validation,
                "Block expects the argument at index {i} to be {expected} but argument has type {actual}"
            );
        }
        self.replace_top(ty.params)?;
        Ok(count)
    }

    /// Leaves the results, as declared, on the stack.
    #[inline(always)]
    fn check_results(&mut self, ty: BlockType) -> Checked {
        let is_exact = match ty {
            BlockType::Empty => self.available() == 0,
            BlockType::Value(result) => self.available() == 1 && self.top() == Some(&mut [result]),
            BlockType::Func(_) => false,
        };
        if is_exact {
            return Ok(());
        }
        self.check_results_fully(ty)
    }

    #[inline(never)]
    fn check_results_fully(&mut self, ty: BlockType) -> Checked {
        let ty = self.types().block_type(&ty);
        let (count, available) = (ty.results.len(), self.available());
        if available == count && self.top_is(ty.results) {
            return Ok(());
        }
        ensure!(
            available <= count && self.has(count),
            validation,
            " block with type: {ty} returns: {count} but stack has: {available} values"
        );
        for (_, actual, expected) in self.operands(ty.results) {
            ensure!(
                self.fits(actual, expected),
                validation,
                "control flow returns with unexpected type. {actual} is not a {expected}"
            );
        }
        self.replace_top(ty.results)
    }

    fn start_arm(&mut self, kind: FrameKind, values: &[ValType]) -> Checked {
        let frame = *self.innermost();
        self.check_results(frame.ty)?;
        self.innermost().kind = kind;
        self.locals.forget_initializations(frame.initialized_height);
        self.height = self.base as usize;
        self.is_unreachable = false;
        self.push_all(values)
    }

    fn start_else(&mut self) -> Checked {
        let ty = self.innermost().ty;
        self.start_arm(FrameKind::Else, self.types().block_type(&ty).params)
    }

    fn start_handler(&mut self, kind: FrameKind, payload: &[ValType]) -> Checked {
        ensure!(
            matches!(self.innermost().kind, FrameKind::Try | FrameKind::Catch),
            validation,
            "catch block isn't associated to a try"
        );
        if self.innermost().kind == FrameKind::Try {
            self.catch_depth += 1;
            self.max_catch_depth = self.max_catch_depth.max(self.catch_depth);
        }
        self.start_arm(kind, payload)
    }

    #[inline(always)]
    fn close(&mut self) -> Checked {
        let frame = *self.innermost();
        self.check_results(frame.ty)?;
        self.frames.pop();
        self.locals.forget_initializations(frame.initialized_height);
        self.is_unreachable = frame.outer_is_unreachable;
        self.base = self.frames.last().map_or(0, |outer| outer.base);
        Ok(())
    }

    #[inline(always)]
    fn check_branch(&mut self, label: u32) -> Checked {
        match *self.target(label) {
            Frame {
                ty: BlockType::Empty,
                ..
            } => Ok(()),
            target => self.check_branch_values(&target),
        }
    }

    #[inline(never)]
    fn check_branch_values(&self, target: &Frame) -> Checked {
        let types = self.label_types(target);
        if self.top_is(types) {
            return Ok(());
        }
        let (count, available) = (types.len(), self.available());
        let ty = self.types().block_type(&target.ty);
        let what = match target.kind {
            FrameKind::Body => "branch out of function",
            _ => "branch to block",
        };
        ensure!(
            self.has(count),
            validation,
            "{what} on expression stack of size {available}, but block, {ty} expects {count} values"
        );
        for (i, actual, expected) in self.operands(types) {
            ensure!(
                self.fits(actual, expected),
                validation,
                "branch's stack type is not a subtype of block's type branch target type. Stack value has type \
                 {actual} but branch target expects a value of {expected} at index {i}"
            );
        }
        Ok(())
    }

    /// The values stay, with the types of the label.
    #[inline(always)]
    fn check_conditional_branch(&mut self, label: u32) -> Checked {
        match *self.target(label) {
            Frame {
                ty: BlockType::Empty,
                ..
            } => Ok(()),
            target => {
                self.check_branch_values(&target)?;
                self.replace_top(self.label_types(&target))
            }
        }
    }

    /// The branch takes the reference along. It is not on the stack afterwards.
    fn check_branch_with(&mut self, name: &'static str, label: u32, ty: RefType) -> Checked {
        let target = self.target(label);
        ensure!(
            !self.label_types(target).is_empty() || target.kind == FrameKind::Constant,
            validation,
            "{name} target expects no values"
        );
        self.push(ty)?;
        self.check_conditional_branch(label)?;
        self.height -= 1;
        Ok(())
    }

    fn pop_cast_operand(&mut self, name: &'static str, from: RefType, to: RefType) -> Checked {
        let value = self.pop(name)?;
        ensure!(
            self.fits(value, from),
            validation,
            "{name} to type {value} expected a reference type with source heaptype"
        );
        ensure!(
            self.fits(to, from),
            validation,
            "target heaptype was not a subtype of source heaptype for {name}"
        );
        Ok(())
    }

    #[inline(always)]
    fn pop_condition(&mut self, what: &'static str) -> Result<Option<ValType>, crate::Error> {
        let value = self.pop(what)?;
        Ok((!is(value, ValType::I32)).then_some(value))
    }

    #[inline(always)]
    fn pop_arguments(&mut self, params: &[ValType], callee: Callee) -> Checked {
        if self.top_is(params) {
            self.height -= params.len();
            return Ok(());
        }
        self.pop_arguments_fully(params, callee)
    }

    #[inline(never)]
    fn pop_arguments_fully(&mut self, params: &[ValType], callee: Callee) -> Checked {
        let (count, available) = (params.len(), self.available());
        let name = match callee {
            Callee::Func(func) => {
                ensure!(
                    self.has(count),
                    parse,
                    "call function index {func} has {count} arguments, but the expression stack currently holds \
                     {available} values"
                );
                "call"
            }
            Callee::Indirect => "call_indirect",
            Callee::Ref => "call_ref",
        };
        for (_, actual, expected) in self.operands(params).rev() {
            ensure!(
                self.fits(actual, expected),
                validation,
                "argument type mismatch in {name}, got {actual}, expected {expected}"
            );
        }
        self.discard(count);
        Ok(())
    }

    fn ensure_callee_and_arguments(&self, name: &'static str, ty: FuncType<'_>) -> Checked {
        let (count, available) = (ty.params.len() + 1, self.available());
        ensure!(
            self.has(count),
            parse,
            "{name} expects {count} arguments, but the expression stack currently holds {available} values"
        );
        Ok(())
    }

    fn pop_indirect_operands(&mut self, ty: TypeIndex, table: TableIndex) -> Checked {
        let ty = self.types().func_type(ty);
        self.ensure_callee_and_arguments("call_indirect", ty)?;
        let address = ValType::int(self.header.table(table).address);
        let index = self.pop("call_indirect")?;
        ensure!(
            is(index, address),
            validation,
            "call_indirect index to type {} expected {address}",
            kind_name(index)
        );
        self.pop_arguments(ty.params, Callee::Indirect)
    }

    fn pop_ref_operands(&mut self, index: TypeIndex) -> Checked {
        ensure!(
            self.has(1),
            parse,
            "can't call_ref on empty expression stack"
        );
        ensure!(
            self.types().kind(index) == TypeKind::Func,
            validation,
            "invalid type index (not a function signature) for call_ref, got {index}"
        );
        let expected = self.types().heap_type(index).nullable();
        if let &[callee] = self.top_slice(1) {
            ensure!(
                self.fits(callee, expected),
                validation,
                "invalid type for call_ref value, expected {expected} got {callee}"
            );
        }
        let ty = self.types().func_type(index);
        self.ensure_callee_and_arguments("call_ref", ty)?;
        self.discard(1);
        self.pop_arguments(ty.params, Callee::Ref)
    }

    #[inline(always)]
    fn push_results(&mut self, ty: TypeIndex) -> Checked {
        self.uses_simd |= self.types().signature_has_v128(ty);
        self.push_all(self.types().func_type(ty).results)
    }

    fn check_tail_call(&mut self, ty: TypeIndex, callee: Callee) -> Checked {
        let body = self.frames[0].ty;
        let results = self.types().func_type(ty).results;
        let expected = self.types().block_type(&body).results;
        let (count, expected_count) = (results.len(), expected.len());
        if count != expected_count {
            match callee {
                Callee::Func(func) => fail!(
                    parse,
                    "tail call function index {func} with return count {count}, but the caller's signature has \
                     {expected_count} return values"
                ),
                _ => fail!(
                    parse,
                    "tail call indirect function with return count {count}_s, but the caller's signature has \
                     {expected_count} return values"
                ),
            }
        }
        let mut pairs = results.iter().zip(expected);
        if let Some((&actual, &expected)) = pairs.find(|&(&a, &b)| !self.fits(a, b)) {
            let name = match callee {
                Callee::Func(func) => format!("function index {func}"),
                Callee::Indirect => "indirect".into(),
                Callee::Ref => "ref".into(),
            };
            fail!(
                validation,
                "tail call {name} return type mismatch: expected {expected}, got {actual}"
            );
        }
        self.set_unreachable()
    }

    fn tag_payload(&mut self, tag: TagIndex) -> &'a [ValType] {
        self.uses_simd |= self
            .types()
            .signature_has_v128(self.header.tags[tag.usize()]);
        self.header.tag_params(tag)
    }
}

/// What is left of `from` if the cast to `to` fails.
fn difference(from: RefType, to: RefType) -> RefType {
    RefType::new(from.heap_type(), from.is_nullable() && !to.is_nullable())
}

#[deny(clippy::missing_trait_methods)]
impl VisitControl for Validator<'_> {
    #[inline(always)]
    fn unreachable(&mut self) -> Checked {
        self.set_unreachable()
    }

    #[inline(always)]
    fn nop(&mut self) -> Checked {
        Ok(())
    }

    #[inline(always)]
    fn block(&mut self, ty: BlockType) -> Checked {
        self.open(FrameKind::Block, ty)
    }

    #[inline(always)]
    fn loop_(&mut self, ty: BlockType, _: u32) -> Checked {
        self.open(FrameKind::Loop, ty)
    }

    #[inline(always)]
    fn if_(&mut self, ty: BlockType) -> Checked {
        if let Some(wrong) = self.pop_condition("if condition")? {
            fail!(validation, "if condition must be i32, got {wrong}");
        }
        self.open(FrameKind::If, ty)
    }

    #[inline(never)]
    fn else_(&mut self, _: Flow) -> Checked {
        ensure!(
            self.innermost().kind == FrameKind::If,
            validation,
            "else block isn't associated to an if"
        );
        self.start_else()
    }

    #[inline(always)]
    fn end(&mut self, _: Flow) -> Checked {
        let frame = self.innermost();
        match frame.kind {
            FrameKind::If if frame.ty != BlockType::Empty => self.start_else()?,
            FrameKind::Catch | FrameKind::CatchAll => self.catch_depth -= 1,
            _ => {}
        }
        self.close()
    }

    #[inline(always)]
    fn br(&mut self, label: u32) -> Checked {
        self.check_branch(label)?;
        self.set_unreachable()
    }

    #[inline(always)]
    fn br_if(&mut self, label: u32) -> Checked {
        if let Some(wrong) = self.pop_condition("br / br_if condition")? {
            fail!(
                validation,
                "conditional branch with non-i32 condition {wrong}"
            );
        }
        self.check_conditional_branch(label)
    }

    #[inline(never)]
    fn br_table(&mut self, table: BrTable<'_>) -> Checked {
        if let Some(wrong) = self.pop_condition("br_table condition")? {
            fail!(validation, "br_table with non-i32 condition {wrong}");
        }
        self.br_tables += 1;
        let arity = self.label_types(self.target(table.default_label())).len();
        for (i, label) in table.labels().enumerate() {
            let place = self.frames.len() - 1 - label as usize;
            let target = self.frames[place];
            if target.checked_by == self.br_tables {
                continue;
            }
            self.frames[place].checked_by = self.br_tables;
            let count = self.label_types(&target).len();
            ensure!(
                count == arity,
                validation,
                "br_table target type size mismatch. Default has size: {arity}but target: {i} has size: {count}"
            );
            self.check_branch(label)?;
        }
        self.br(table.default_label())
    }

    #[inline(never)]
    fn br_on_null(&mut self, label: u32) -> Checked {
        let reference = self.pop_ref("br_on_null", " ref")?;
        self.check_conditional_branch(label)?;
        self.push(reference.heap_type().non_null())
    }

    #[inline(never)]
    fn br_on_non_null(&mut self, label: u32) -> Checked {
        let reference = self.pop_ref("br_on_non_null", " ref")?;
        self.check_branch_with("br_on_non_null", label, reference.heap_type().non_null())
    }

    fn br_on_cast(&mut self, label: u32, from: RefType, to: RefType) -> Checked {
        self.pop_cast_operand("br_on_cast", from, to)?;
        self.check_branch_with("br_on_cast", label, to)?;
        self.push(difference(from, to))
    }

    fn br_on_cast_fail(&mut self, label: u32, from: RefType, to: RefType) -> Checked {
        self.pop_cast_operand("br_on_cast_fail", from, to)?;
        self.check_branch_with("br_on_cast_fail", label, difference(from, to))?;
        self.push(to)
    }

    #[inline(always)]
    fn return_(&mut self) -> Checked {
        let body = self.frames[0];
        self.check_branch_values(&body)?;
        self.set_unreachable()
    }

    #[inline(always)]
    fn call(&mut self, func: FuncIndex, _: u32) -> Checked {
        let index = self.header.func_type_index(func);
        let ty = self.types().func_type(index);
        self.uses_simd |= self.types().signature_has_v128(index);
        self.pop_arguments(ty.params, Callee::Func(func))?;
        self.push_all(ty.results)
    }

    #[inline(never)]
    fn call_indirect(&mut self, ty: TypeIndex, table: TableIndex, _: u32) -> Checked {
        self.pop_indirect_operands(ty, table)?;
        self.push_results(ty)
    }

    #[inline(never)]
    fn call_ref(&mut self, ty: TypeIndex, _: u32) -> Checked {
        self.pop_ref_operands(ty)?;
        self.push_results(ty)
    }

    #[inline(never)]
    fn return_call(&mut self, func: FuncIndex, _: u32) -> Checked {
        let ty = self.header.func_type_index(func);
        self.pop_arguments(self.types().func_type(ty).params, Callee::Func(func))?;
        self.check_tail_call(ty, Callee::Func(func))
    }

    #[inline(never)]
    fn return_call_indirect(&mut self, ty: TypeIndex, table: TableIndex, _: u32) -> Checked {
        self.pop_indirect_operands(ty, table)?;
        self.check_tail_call(ty, Callee::Indirect)
    }

    #[inline(never)]
    fn return_call_ref(&mut self, ty: TypeIndex, _: u32) -> Checked {
        self.pop_ref_operands(ty)?;
        self.check_tail_call(ty, Callee::Ref)
    }

    #[inline(never)]
    fn throw(&mut self, tag: TagIndex) -> Checked {
        let ty = self.types().func_type(self.header.tags[tag.usize()]);
        let (count, available) = (ty.params.len(), self.available());
        ensure!(
            self.has(count),
            validation,
            "Too few arguments on stack for the exception being thrown. The exception expects {count}, but only \
             {available} were present. Exception has signature: {ty}"
        );
        for (i, actual, expected) in self.operands(ty.params).rev() {
            let i = count - 1 - i;
            ensure!(
                self.fits(actual, expected),
                validation,
                "The exception being thrown expects the argument at index {i} to be {expected} but argument has \
                 type {actual}"
            );
        }
        self.set_unreachable()
    }

    #[inline(never)]
    fn throw_ref(&mut self) -> Checked {
        let exception = self.pop("exception reference")?;
        ensure!(
            self.fits(exception, ValType::EXNREF),
            validation,
            "throw_ref expected an exception reference"
        );
        self.set_unreachable()
    }

    #[inline(never)]
    fn try_table(&mut self, ty: BlockType, catches: Catches<'_>) -> Checked {
        const EXNREF: ValType = HeapType::EXN.non_null().value_type();
        self.open(FrameKind::Block, ty)?;
        for catch in catches {
            let payload = catch.tag.map_or(&[][..], |tag| self.tag_payload(tag));
            let exnref = if catch.passes_exnref {
                slice::from_ref(&EXNREF)
            } else {
                &[]
            };
            let expected = self.label_types(self.target(catch.label + 1));
            ensure!(
                payload.len() + exnref.len() == expected.len(),
                validation,
                ""
            );
            let mut pairs = payload.iter().chain(exnref).zip(expected);
            ensure!(
                pairs.all(|(&actual, &expected)| self.fits(actual, expected)),
                validation,
                "try_table target type mismatch"
            );
        }
        Ok(())
    }

    #[inline(always)]
    fn try_(&mut self, ty: BlockType) -> Checked {
        self.open(FrameKind::Try, ty)
    }

    #[inline(never)]
    fn catch(&mut self, tag: TagIndex, _: Flow) -> Checked {
        let payload = self.tag_payload(tag);
        self.start_handler(FrameKind::Catch, payload)
    }

    #[inline(never)]
    fn catch_all(&mut self, _: Flow) -> Checked {
        self.start_handler(FrameKind::CatchAll, &[])
    }

    #[inline(never)]
    fn delegate(&mut self, _: u32, _: Flow) -> Checked {
        ensure!(
            self.innermost().kind == FrameKind::Try,
            validation,
            "delegate isn't associated to a try"
        );
        self.close()
    }

    #[inline(never)]
    fn rethrow(&mut self, label: u32) -> Checked {
        ensure!(
            matches!(
                self.target(label).kind,
                FrameKind::Catch | FrameKind::CatchAll
            ),
            validation,
            "rethrow doesn't refer to a catch block"
        );
        self.set_unreachable()
    }
}
