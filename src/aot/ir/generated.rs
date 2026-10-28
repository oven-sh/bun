#![allow(dead_code, unreachable_pub, unused_imports, unused_variables)]
#![allow(
    clippy::too_many_arguments,
    clippy::fn_params_excessive_bools,
    clippy::identity_op,
    clippy::cast_ptr_alignment
)]
#![allow(clippy::trivially_copy_pass_by_ref, clippy::chunks_exact_to_as_chunks)]
// One generator writes every copy.
#![cfg_attr(mordant, allow(generic_body_not_generic, reimplemented_helper))]

include!(concat!(env!("BUN_CODEGEN_DIR"), "/aot_schema.rs"));
