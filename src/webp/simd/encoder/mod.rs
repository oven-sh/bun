//! The arithmetic of the lossy encoder. The kernels are `#[inline(never)]`: on arm64, which has one target and no
//! dispatch, they would be inlined into their callers, which is slower.

mod blocks;
mod macroblocks;
mod rgba;
mod subblocks;
mod types;

pub(crate) use {macroblocks::*, rgba::*, subblocks::*, types::*};
