//! Private fields, and the brands that stand for private methods.

use bun_engine_bytecode::{MetadataKind, Operand, Register, op};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::JsObject;
use bun_engine_vm::code::metadata::{GetPrivateName, PutPrivateName};
use bun_engine_vm::ic::AccessCases;

use super::{Builder, Built};
use crate::graph::Cache;

impl Builder<'_> {
    pub(super) fn get_private_name(&mut self, op: op::GetPrivateName) -> Built {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::GetPrivateName);
        let entry = (code_block.anchor()).checked_metadata::<GetPrivateName>(kind, op.metadata);
        let operands = [self.get_value(op.base), self.get_value(op.name)];
        if let Some(value) = self.cached_load(Cache::GetPrivateName, entry, &operands, op.metadata)
        {
            self.set(op.dst, value);
        }
        Ok(())
    }

    pub(super) fn put_private_name(
        &mut self,
        cache: Cache<PutPrivateName>,
        [base, name]: [Operand; 2],
        value: Ssa,
        (kind, metadata): (MetadataKind, u32),
    ) -> Built {
        let code_block = self.frame().code_block;
        let entry = (code_block.anchor()).checked_metadata::<PutPrivateName>(kind, metadata);
        let operands = [self.get_value(base), self.get_value(name), value];
        self.cached(cache, entry, &operands);
        Ok(())
    }

    pub(super) fn set_private_brand(&mut self, op: op::SetPrivateBrand) -> Built {
        let value = self.value(JsObject::PRIVATE_BRAND_VALUE);
        let (operands, entry) = (
            [op.base.into(), op.brand.into()],
            (MetadataKind::PrivateBrand, op.metadata),
        );
        self.put_private_name(Cache::SetPrivateBrand, operands, value, entry)
    }

    pub(super) fn check_private_brand(&mut self, op: op::CheckPrivateBrand) {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::PrivateBrand);
        let entry = (code_block.anchor()).checked_metadata::<PutPrivateName>(kind, op.metadata);
        let operands = [self.get_value(op.base), self.get_value(op.brand)];
        self.cached(Cache::CheckPrivateBrand, entry, &operands);
    }

    pub(super) fn has_private_name(
        &mut self,
        dst: Register,
        [base, name]: [Operand; 2],
        metadata: u32,
    ) -> Built {
        let (code_block, kind) = (self.frame().code_block, MetadataKind::LazyCache);
        let list = (code_block.anchor()).checked_metadata::<AccessCases>(kind, metadata);
        let operands = [self.get_value(base), self.get_value(name)];
        let answer = self.cached_test(Cache::HasPrivateName, list, &operands);
        self.set(dst, answer);
        Ok(())
    }
}
