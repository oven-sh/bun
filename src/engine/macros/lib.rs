//! Procedural macros of the engine. What they expand to is documented beside the traits of `bun_engine_vm`.

mod cell;
mod direct_form;
mod export;
mod field_offsets;
mod in_call_frame;
mod native_abi;
mod object_ops;
mod trace;

use proc_macro::TokenStream;

fn expand(result: syn::Result<proc_macro2::TokenStream>) -> TokenStream {
    result.unwrap_or_else(syn::Error::into_compile_error).into()
}

/// Declares a type of cell. See `bun_engine_vm::CellKind`.
#[proc_macro_attribute]
pub fn cell(arguments: TokenStream, item: TokenStream) -> TokenStream {
    expand(cell::expand(arguments.into(), item.into()))
}

/// The internal methods that a type of object overrides. See `bun_engine_vm::ClassOps`. With `export = "prefix"` the
/// entry for `put` is the symbol `prefix_put`, for classes that extend the type in C++.
#[proc_macro_attribute]
pub fn object_ops(arguments: TokenStream, item: TokenStream) -> TokenStream {
    expand(object_ops::expand(arguments.into(), item.into()))
}

/// Traces every field that can refer to a cell.
#[proc_macro_derive(Trace)]
pub fn derive_trace(item: TokenStream) -> TokenStream {
    expand(trace::expand(item.into()))
}

/// Gives a function, or an alias of a function pointer, the calling convention that generated code calls with.
#[proc_macro_attribute]
pub fn native_abi(_: TokenStream, item: TokenStream) -> TokenStream {
    expand(native_abi::expand(item.into()))
}

/// Describes a function to the compilers and gives it an entry that they can call. See `bun_engine_vm::direct`.
#[proc_macro_attribute]
pub fn direct_form(arguments: TokenStream, item: TokenStream) -> TokenStream {
    expand(direct_form::expand(arguments.into(), item.into()))
}

/// Puts a function among those of `bun_engine_vm::call::code_in_call_frames`. With `naked` for one that is.
#[proc_macro_attribute]
pub fn in_call_frame(arguments: TokenStream, item: TokenStream) -> TokenStream {
    in_call_frame::expand(&arguments.into(), &item.into()).into()
}

/// Makes a function of `bun_engine_embed` the C function `engine_<name>`. See `abi.rs` there.
#[proc_macro_attribute]
pub fn export(_: TokenStream, item: TokenStream) -> TokenStream {
    expand(export::expand(item.into()))
}

/// Gives a `repr(C)` struct `offset_of_field`. A cell that exports its class has it too.
#[proc_macro_derive(FieldOffsets)]
pub fn derive_field_offsets(item: TokenStream) -> TokenStream {
    expand(field_offsets::expand(item.into()))
}
