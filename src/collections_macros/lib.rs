//! Proc-macros for `bun_collections`.
//!
//! `#[derive(MultiArrayElement)]` is the compile-time port of Zig's
//! `@typeInfo(T)` / `meta.fields(Elem)` / `meta.FieldEnum(Elem)` reflection
//! that drives `std.MultiArrayList` (`src/collections/multi_array_list.zig`).
//! Zig iterates struct fields at comptime to compute per-field column layout
//! and to scatter/gather elements; Rust has no reflection, so the derive
//! emits the equivalent metadata as a `MultiArrayElement` trait impl plus a
//! `Field` enum and typed per-field slice accessors.
//!
//! For a struct
//! ```ignore
//! #[derive(MultiArrayElement)]
//! struct Foo { a: u32, b: u8, c: u64 }
//! ```
//! this expands to (roughly):
//!   * `enum FooField { a, b, c }`  — Zig's `meta.FieldEnum(Elem)`.
//!   * `impl MultiArrayElement for Foo { … }` with `SIZES_BYTES` /
//!     `SIZES_FIELDS` computed by a const-eval bubble sort (Zig's
//!     `mem.sort(Data, &data, {}, Sort.lessThan)` over `(size, align)`).
//!   * `trait FooSliceExt` with `fn a(&self) -> &mut [u32]` etc. — the safe
//!     typed wrappers around `Slice::items` that Zig got for free from
//!     `FieldType(field)`.
//!
//! The Zig also special-cases `union(enum)` by synthesizing a
//! `{ tags: Tag, data: Bare }` wrapper struct. That wrapper is *not*
//! synthesised here — derive on the wrapper struct directly.

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::{format_ident, quote};
use syn::{parse_macro_input, Data, DeriveInput, Fields, Ident};

#[proc_macro_derive(MultiArrayElement)]
pub fn derive_multi_array_element(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn expand(input: DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    let name = &input.ident;
    let vis = &input.vis;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();
    let has_generics = !input.generics.params.is_empty();

    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "MultiArrayElement can only be derived for structs \
             (for tagged unions, derive on the `{ tags, data }` wrapper struct)",
        ));
    };
    let Fields::Named(named) = &data.fields else {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "MultiArrayElement requires named fields",
        ));
    };

    let field_idents: Vec<&Ident> = named.named.iter().map(|f| f.ident.as_ref().unwrap()).collect();
    let field_tys: Vec<&syn::Type> = named.named.iter().map(|f| &f.ty).collect();
    let n = field_idents.len();
    let n_lit = proc_macro2::Literal::usize_unsuffixed(n);
    let indices: Vec<proc_macro2::Literal> =
        (0..n).map(proc_macro2::Literal::usize_unsuffixed).collect();

    // ── Field enum ─────────────────────────────────────────────────────
    // Zig: `pub const Field = meta.FieldEnum(Elem);`
    let field_enum = format_ident!("{}Field", name);
    let variants = field_idents.iter().zip(&indices).map(|(id, ix)| quote!(#id = #ix));

    // ── const-eval `sizes` block ───────────────────────────────────────
    // Zig: the `const sizes = blk: { … mem.sort … }` block, sorting fields by
    // alignment descending. `size_of`/`align_of` are const fns, so a simple
    // stable bubble sort in a `const` initializer reproduces it exactly,
    // including the ZST → align=1 special case.
    let sorted_const = format_ident!("__{}_MAL_SIZES", name.to_string().to_uppercase());
    let sizes_block = quote! {
        #[doc(hidden)]
        #[allow(non_upper_case_globals)]
        const #sorted_const: ([usize; #n_lit], [usize; #n_lit]) = {
            // (size, effective_align, original field index)
            let mut data: [(usize, usize, usize); #n_lit] = [
                #(
                    (
                        ::core::mem::size_of::<#field_tys>(),
                        if ::core::mem::size_of::<#field_tys>() == 0 {
                            1
                        } else {
                            ::core::mem::align_of::<#field_tys>()
                        },
                        #indices,
                    ),
                )*
            ];
            // Stable bubble sort, descending by alignment.
            let mut i = 0;
            while i < #n_lit {
                let mut j = 0;
                while j + 1 + i < #n_lit {
                    if data[j].1 < data[j + 1].1 {
                        let tmp = data[j];
                        data[j] = data[j + 1];
                        data[j + 1] = tmp;
                    }
                    j += 1;
                }
                i += 1;
            }
            let mut bytes = [0usize; #n_lit];
            let mut fields = [0usize; #n_lit];
            let mut k = 0;
            while k < #n_lit {
                bytes[k] = data[k].0;
                fields[k] = data[k].2;
                k += 1;
            }
            (bytes, fields)
        };
    };

    // ── scatter / gather ───────────────────────────────────────────────
    // Zig: `inline for (fields, 0..) |f, i| ptrs[i][index] = @field(e, f.name)`
    // and the inverse for `get`. `ptrs` is indexed by *field index* (not the
    // alignment-sorted index) — see `Slice::items` / `MultiArrayList::slice`.
    let scatter = field_idents.iter().zip(&field_tys).zip(&indices).map(|((id, ty), ix)| {
        quote! {
            ::core::ptr::write(ptrs[#ix].cast::<#ty>().add(index), self.#id);
        }
    });
    let gather = field_idents.iter().zip(&field_tys).zip(&indices).map(|((id, ty), ix)| {
        quote! {
            #id: ::core::ptr::read(ptrs[#ix].cast::<#ty>().add(index)),
        }
    });

    // ── per-field typed accessors ──────────────────────────────────────
    // Zig: `slice.items(.field)` returns `[]FieldType(field)` because the
    // compiler maps the comptime enum value to a type. Rust can't, so emit a
    // `*SliceExt` trait with one safe method per field that calls the unsafe
    // `Slice::items::<F>` with the correct `F`. Skipped for generic structs
    // (would require a generic extension trait); callers use `items` directly.
    let slice_ext = if has_generics {
        quote! {}
    } else {
        let ext = format_ident!("{}SliceExt", name);
        let sigs = field_idents.iter().zip(&field_tys).map(|(id, ty)| {
            quote! { fn #id(&self) -> &mut [#ty]; }
        });
        let impls = field_idents.iter().zip(&field_tys).map(|(id, ty)| {
            quote! {
                #[inline]
                fn #id(&self) -> &mut [#ty] {
                    // SAFETY: `#ty` is exactly the type of field `#id`;
                    // `#field_enum::#id as usize` is its column index.
                    unsafe { self.items::<#ty>(#field_enum::#id) }
                }
            }
        });
        quote! {
            #[allow(non_camel_case_types)]
            #vis trait #ext {
                #(#sigs)*
            }
            impl #ext for bun_collections::multi_array_list::Slice<#name> {
                #(#impls)*
            }
        }
    };

    Ok(quote! {
        #[allow(non_camel_case_types)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(usize)]
        #vis enum #field_enum {
            #(#variants,)*
        }

        #sizes_block

        #[allow(clippy::all)]
        const _: () = {
            // Zig has no bound (comptime array); see `MAX_FIELDS` in
            // multi_array_list.rs for why Rust needs one.
            assert!(
                #n_lit <= bun_collections::multi_array_list::MAX_FIELDS,
                "MultiArrayElement: too many fields (raise MAX_FIELDS)",
            );
        };

        impl #impl_generics bun_collections::MultiArrayElement for #name #ty_generics #where_clause {
            type Field = #field_enum;

            const FIELD_COUNT: usize = #n_lit;
            const ALIGN: usize = ::core::mem::align_of::<Self>();
            const SIZES_BYTES: &'static [usize] = &#sorted_const.0;
            const SIZES_FIELDS: &'static [usize] = &#sorted_const.1;

            #[inline]
            fn field_index(field: Self::Field) -> usize {
                field as usize
            }

            #[inline]
            unsafe fn scatter(self, ptrs: &[*mut u8], index: usize) {
                unsafe {
                    #(#scatter)*
                }
            }

            #[inline]
            unsafe fn gather(ptrs: &[*mut u8], index: usize) -> Self {
                unsafe {
                    Self { #(#gather)* }
                }
            }
        }

        #slice_ext
    })
}

// Silence "unused import" if a future refactor stops needing it.
const _: Option<Span> = None;
