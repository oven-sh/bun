#![allow(non_upper_case_globals, dead_code, clippy::derivable_impls)]
#![allow(clippy::needless_pass_by_value, clippy::large_types_passed_by_value)]
#![cfg_attr(mordant, allow(unused_pub))]

use core::ffi::c_void;
use core::mem::offset_of;

use bun_core::{ExternalSharedDescriptor, heap};

use crate::host::AutoreleasePool;
use crate::{Bool, Chain, Chained, ChainedStruct, Ref, Slice, StringView};

include!(concat!(env!("BUN_CODEGEN_DIR"), "/dawn_sys.rs"));
