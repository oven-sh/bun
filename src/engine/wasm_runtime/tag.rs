//! Tags of exceptions.

use std::sync::Arc;

use bun_engine_wasm_compiler::abi::payload_offsets;
use bun_engine_wasm_format::{CanonicalType, ValType};

/// Its address identifies it.
pub struct Tag {
    ty: CanonicalType,
    /// Defined types are replaced by the closest abstract ones.
    params: Box<[ValType]>,
    payload_size: u32,
}

impl Tag {
    /// `ty` is that of a function without results.
    pub fn new(ty: CanonicalType) -> Arc<Self> {
        let params: Box<[ValType]> = ty.params().map(|param| param.erased()).collect();
        let payload_size = payload_offsets(&params).last().unwrap_or(0);
        Arc::new(Self {
            ty,
            params,
            payload_size,
        })
    }

    pub fn ty(&self) -> &CanonicalType {
        &self.ty
    }

    /// What exceptions have at `HostLayout::exception_tag`.
    pub fn identity(&self) -> usize {
        core::ptr::from_ref(self).expose_provenance()
    }

    pub fn payload_size(&self) -> u32 {
        self.payload_size
    }

    /// The type of each value, with the closest abstract type for a defined one, and its offset in the payload.
    pub fn payload(&self) -> impl Iterator<Item = (ValType, u32)> {
        let params = self.params.iter().copied();
        params.zip(payload_offsets(&self.params))
    }
}
