//! `comptime_string_map!` / `comptime_string_set!` expansion.
//!
//! Port of Zig's `ComptimeStringMap`: keys are grouped by
//! length at expansion time so a lookup is one `match key.len()` (a jump
//! table) followed by constant-length byte-slice compares, which LLVM lowers
//! to word-sized loads compared against immediates — no hashing, no memcmp
//! calls. See `known_global.rs` in `bun_ast` for the hand-written shape this
//! automates.

use proc_macro2::{Span, TokenStream};
use quote::{format_ident, quote};
use syn::{
    Attribute, Expr, Ident, Lit, LitByteStr, Token, Type, Visibility, braced, parenthesized,
    parse::{Parse, ParseStream},
};

struct Input {
    crate_path: TokenStream,
    attrs: Vec<Attribute>,
    vis: Visibility,
    name: Ident,
    /// `None` for the set form.
    value_ty: Option<Type>,
    keys: Vec<(Vec<u8>, Span)>,
    /// Empty for the set form.
    values: Vec<Expr>,
}

fn parse_key(lit: Lit) -> syn::Result<(Vec<u8>, Span)> {
    match lit {
        Lit::ByteStr(s) => Ok((s.value(), s.span())),
        Lit::Str(s) => Ok((s.value().into_bytes(), s.span())),
        other => Err(syn::Error::new(
            other.span(),
            "expected a string or byte-string literal key",
        )),
    }
}

fn parse_input(input: ParseStream, is_set: bool) -> syn::Result<Input> {
    // `@crate_path($crate)` — injected by the `macro_rules!` wrapper in
    // `bun_core` so generated code can name `bun_core` items hygienically.
    input.parse::<Token![@]>()?;
    let marker: Ident = input.parse()?;
    if marker != "crate_path" {
        return Err(syn::Error::new(marker.span(), "expected `crate_path`"));
    }
    let path_content;
    parenthesized!(path_content in input);
    let crate_path: TokenStream = path_content.parse()?;

    let attrs = input.call(Attribute::parse_outer)?;
    let vis: Visibility = input.parse()?;
    input.parse::<Token![static]>()?;
    let name: Ident = input.parse()?;
    let value_ty = if is_set {
        None
    } else {
        input.parse::<Token![:]>()?;
        Some(input.parse::<Type>()?)
    };
    input.parse::<Token![=]>()?;

    let content;
    braced!(content in input);
    let mut keys = Vec::new();
    let mut values = Vec::new();
    while !content.is_empty() {
        keys.push(parse_key(content.parse::<Lit>()?)?);
        if !is_set {
            content.parse::<Token![=>]>()?;
            values.push(content.parse::<Expr>()?);
        }
        if content.is_empty() {
            break;
        }
        content.parse::<Token![,]>()?;
    }
    if input.peek(Token![;]) {
        input.parse::<Token![;]>()?;
    }
    if !input.is_empty() {
        return Err(input.error("expected a single `static` declaration"));
    }

    if keys.is_empty() {
        return Err(syn::Error::new(
            name.span(),
            "comptime string map requires at least one entry",
        ));
    }
    let mut seen = std::collections::BTreeSet::new();
    for (key, span) in &keys {
        if !seen.insert(key.as_slice()) {
            return Err(syn::Error::new(
                *span,
                format!("duplicate key \"{}\"", key.escape_ascii()),
            ));
        }
    }

    Ok(Input {
        crate_path,
        attrs,
        vis,
        name,
        value_ty,
        keys,
        values,
    })
}

struct MapParse(Input);
impl Parse for MapParse {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        parse_input(input, false).map(MapParse)
    }
}
struct SetParse(Input);
impl Parse for SetParse {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        parse_input(input, true).map(SetParse)
    }
}

/// Buckets of declaration-order indexes, grouped by key length, sorted by
/// (length asc, bytes asc) within each bucket.
fn length_buckets(keys: &[(Vec<u8>, Span)]) -> Vec<(usize, Vec<usize>)> {
    let mut order: Vec<usize> = (0..keys.len()).collect();
    order.sort_by(|&a, &b| {
        keys[a]
            .0
            .len()
            .cmp(&keys[b].0.len())
            .then_with(|| keys[a].0.cmp(&keys[b].0))
    });
    let mut buckets: Vec<(usize, Vec<usize>)> = Vec::new();
    for idx in order {
        let len = keys[idx].0.len();
        match buckets.last_mut() {
            Some((l, v)) if *l == len => v.push(idx),
            _ => buckets.push((len, vec![idx])),
        }
    }
    buckets
}

fn key_lit(keys: &[(Vec<u8>, Span)], idx: usize) -> LitByteStr {
    LitByteStr::new(&keys[idx].0, keys[idx].1)
}

/// Declaration-order concatenation of all keys plus a per-key length table,
/// with the length type sized to the longest key. Lets `keys()`/`iter()`
/// reconstruct `&'static [u8]` slices without storing a pointer per key.
fn key_blob(keys: &[(Vec<u8>, Span)]) -> (LitByteStr, usize, Vec<TokenStream>, TokenStream) {
    let blob: Vec<u8> = keys.iter().flat_map(|(k, _)| k.iter().copied()).collect();
    let total = blob.len();
    let max_len = keys.iter().map(|(k, _)| k.len()).max().unwrap_or(0);
    let len_ty = if max_len <= u8::MAX as usize {
        quote!(::core::primitive::u8)
    } else if max_len <= u16::MAX as usize {
        quote!(::core::primitive::u16)
    } else {
        quote!(::core::primitive::u32)
    };
    let lens = keys
        .iter()
        .map(|(k, _)| {
            let len = k.len();
            quote!(#len as _)
        })
        .collect();
    (
        LitByteStr::new(&blob, Span::call_site()),
        total,
        lens,
        len_ty,
    )
}

/// Longest constant slice-`==` LLVM still expands into inline loads instead
/// of a `memcmp` call (4 × 16-byte loads on both aarch64 and x86-64-with-SSE).
const MAX_INLINE_EQ_LEN: usize = 64;

/// `key == lit` for keys longer than [`MAX_INLINE_EQ_LEN`], written the way
/// `strings.eqlComptime` unrolls in the Zig original: XOR 8/4/2/1-byte chunks
/// against constants and OR-accumulate, comparing once at the end. A single
/// branchless block — MergeICmps only rewrites compare-and-branch chains, so
/// this can never be turned back into a `memcmp` call.
fn chunked_eq(key: &[u8], span: Span) -> TokenStream {
    let mut terms = Vec::new();
    let mut off = 0usize;
    for width in [8usize, 4, 2, 1] {
        while key.len() - off >= width {
            let chunk = LitByteStr::new(&key[off..off + width], span);
            let end = off + width;
            let term = match width {
                8 => quote! {
                    (::core::primitive::u64::from_ne_bytes(
                        key[#off..#end].try_into().unwrap(),
                    ) ^ ::core::primitive::u64::from_ne_bytes(*#chunk))
                },
                4 => quote! {
                    ((::core::primitive::u32::from_ne_bytes(
                        key[#off..#end].try_into().unwrap(),
                    ) ^ ::core::primitive::u32::from_ne_bytes(*#chunk)) as ::core::primitive::u64)
                },
                2 => quote! {
                    ((::core::primitive::u16::from_ne_bytes(
                        key[#off..#end].try_into().unwrap(),
                    ) ^ ::core::primitive::u16::from_ne_bytes(*#chunk)) as ::core::primitive::u64)
                },
                _ => quote! {
                    ((key[#off] ^ #chunk[0]) as ::core::primitive::u64)
                },
            };
            terms.push(term);
            off += width;
        }
    }
    quote! { (#(#terms)|*) == 0 }
}

/// The equality check for one key in a `match key.len()` arm: plain `==` for
/// keys LLVM inlines on its own, explicit chunked compares past that.
fn eq_check(keys: &[(Vec<u8>, Span)], idx: usize) -> TokenStream {
    let (key, span) = &keys[idx];
    if key.len() > MAX_INLINE_EQ_LEN {
        chunked_eq(key, *span)
    } else {
        let lit = key_lit(keys, idx);
        quote! { key == #lit }
    }
}

pub(crate) fn expand_map(input: TokenStream) -> syn::Result<TokenStream> {
    let MapParse(input) = syn::parse2(input)?;
    let Input {
        crate_path,
        attrs,
        vis,
        name,
        value_ty,
        keys,
        values,
    } = input;
    let value_ty = value_ty.expect("map form always has a value type");

    let ty_name = format_ident!("__ComptimeStringMap_{}", name);
    let values_name = format_ident!("__COMPTIME_STRING_MAP_VALUES_{}", name);
    let blob_name = format_ident!("__COMPTIME_STRING_MAP_KEY_BLOB_{}", name);
    let lens_name = format_ident!("__COMPTIME_STRING_MAP_KEY_LENS_{}", name);
    let n = keys.len();
    let buckets = length_buckets(&keys);
    let min_len = buckets.first().map(|(l, _)| *l).unwrap_or(0);
    let max_len = buckets.last().map(|(l, _)| *l).unwrap_or(0);
    let (blob_lit, blob_total, lens, len_ty) = key_blob(&keys);

    // `match key.len()` arms: constant-length `==` compares so LLVM merges
    // them into word loads + a compare tree. Arms yield a `u32` index into
    // the values table (`u32::MAX` = miss) rather than materializing a value
    // reference each — smaller leaves, and the caller's slice bounds check
    // doubles as the miss check.
    let eq_arms = buckets.iter().map(|(len, idxs)| {
        let checks = idxs.iter().map(|&i| {
            let check = eq_check(&keys, i);
            let idx = u32::try_from(i).expect("map too large");
            quote! {
                if #check {
                    return #idx;
                }
            }
        });
        quote! {
            #len => { #(#checks)* ::core::primitive::u32::MAX }
        }
    });

    // Same dispatch with a caller-supplied comparator; monomorphized only
    // when actually used (case-insensitive and encoding-aware lookups).
    let eql_arms = buckets.iter().map(|(len, idxs)| {
        let checks = idxs.iter().map(|&i| {
            let lit = key_lit(&keys, i);
            let idx = u32::try_from(i).expect("map too large");
            quote! {
                if eql(input, #lit) {
                    break 'found #idx;
                }
            }
        });
        quote! {
            #len => { #(#checks)* ::core::primitive::u32::MAX }
        }
    });

    let decl_keys = (0..n).map(|i| key_lit(&keys, i));
    let decl_values = values.iter();
    let decl_values_again = values.iter();

    Ok(quote! {
        #(#attrs)*
        #vis static #name: #ty_name = #ty_name(());

        #[doc(hidden)]
        #[allow(non_camel_case_types)]
        #vis struct #ty_name(());

        #[doc(hidden)]
        static #values_name: [#value_ty; #n] = [ #(#decl_values),* ];

        // Keys are baked into the lookup's compare instructions; these two
        // pointer-free tables exist only so `entries()`/`keys()` can hand out
        // `&'static [u8]` slices without a per-key pointer (and its load-time
        // relocation) in the data segment.
        #[doc(hidden)]
        static #blob_name: [u8; #blob_total] = *#blob_lit;
        #[doc(hidden)]
        static #lens_name: [#len_ty; #n] = [ #(#lens),* ];

        #[allow(dead_code)]
        impl #ty_name {
            #vis const MIN_LEN: usize = #min_len;
            #vis const MAX_LEN: usize = #max_len;
            /// Entries in declaration order, for `const` contexts. Referencing
            /// this materializes a pointer-per-key table at the use site —
            /// runtime callers should use `entries()`/`keys()` instead, which
            /// read the pointer-free blob.
            #vis const ENTRIES: &'static [(&'static [u8], #value_ty)] =
                &[ #( (#decl_keys, #decl_values_again) ),* ];

            /// Declaration-order index of `key`, or `u32::MAX` for a miss.
            #[doc(hidden)]
            #[inline]
            #vis fn __key_index(key: &[u8]) -> ::core::primitive::u32 {
                match key.len() {
                    #(#eq_arms)*
                    _ => ::core::primitive::u32::MAX,
                }
            }

            #[inline]
            #vis fn get(&self, key: &[u8]) -> ::core::option::Option<&'static #value_ty> {
                #values_name.get(Self::__key_index(key) as usize)
            }

            #[inline]
            #vis fn contains_key(&self, key: &[u8]) -> bool {
                self.get(key).is_some()
            }

            #vis fn len(&self) -> usize {
                #n
            }

            #vis fn entries(
                &self,
            ) -> impl Iterator<Item = (&'static [u8], &'static #value_ty)> {
                self.keys().zip(#values_name.iter())
            }

            #vis fn keys(&self) -> impl Iterator<Item = &'static [u8]> {
                let mut off = 0usize;
                #lens_name.iter().map(move |len| {
                    let len = *len as usize;
                    let key = &#blob_name[off..off + len];
                    off += len;
                    key
                })
            }

            #vis fn values(&self) -> impl Iterator<Item = &'static #value_ty> {
                #values_name.iter()
            }

            /// Length-dispatched lookup with a caller-supplied comparator.
            /// `len` must be the logical length of `input` in the comparator's
            /// units (bytes for byte slices, code units for UTF-16 strings).
            #[inline(always)]
            #vis fn get_with_len_and_eql<I: Copy>(
                &self,
                input: I,
                len: usize,
                eql: impl Fn(I, &'static [u8]) -> bool,
            ) -> ::core::option::Option<&'static #value_ty> {
                let index = 'found: {
                    match len {
                        #(#eql_arms)*
                        _ => ::core::primitive::u32::MAX,
                    }
                };
                #values_name.get(index as usize)
            }

            #[inline]
            #vis fn get_with_eql<I>(
                &self,
                input: I,
                eql: impl Fn(I, &'static [u8]) -> bool,
            ) -> ::core::option::Option<&'static #value_ty>
            where
                I: Copy + #crate_path::comptime_string_map::HasLength,
            {
                let len = input.length();
                self.get_with_len_and_eql(input, len, eql)
            }

            /// ASCII-lowercases `key` into a stack buffer, then looks it up.
            /// Keys must be declared in lowercase for this to match.
            #[inline]
            #vis fn get_ascii_case_insensitive(
                &self,
                key: &[u8],
            ) -> ::core::option::Option<&'static #value_ty> {
                if key.len() < Self::MIN_LEN || key.len() > Self::MAX_LEN {
                    return ::core::option::Option::None;
                }
                let mut buf = [0u8; Self::MAX_LEN];
                let buf = &mut buf[..key.len()];
                for (dst, src) in buf.iter_mut().zip(key.iter()) {
                    *dst = src.to_ascii_lowercase();
                }
                self.get_with_len_and_eql(&*buf, key.len(), |a: &[u8], b| a == b)
            }
        }

        impl #crate_path::comptime_string_map::ComptimeStringMap for #ty_name {
            type Value = #value_ty;

            #[inline]
            fn lookup(&self, key: &[u8]) -> ::core::option::Option<&'static #value_ty> {
                self.get(key)
            }

            #[inline]
            fn lookup_ascii_case_insensitive(
                &self,
                key: &[u8],
            ) -> ::core::option::Option<&'static #value_ty> {
                self.get_ascii_case_insensitive(key)
            }

        }
    })
}

pub(crate) fn expand_set(input: TokenStream) -> syn::Result<TokenStream> {
    let SetParse(input) = syn::parse2(input)?;
    let Input {
        crate_path: _,
        attrs,
        vis,
        name,
        value_ty: _,
        keys,
        values: _,
    } = input;

    let ty_name = format_ident!("__ComptimeStringSet_{}", name);
    let blob_name = format_ident!("__COMPTIME_STRING_SET_KEY_BLOB_{}", name);
    let lens_name = format_ident!("__COMPTIME_STRING_SET_KEY_LENS_{}", name);
    let n = keys.len();
    let buckets = length_buckets(&keys);
    let min_len = buckets.first().map(|(l, _)| *l).unwrap_or(0);
    let max_len = buckets.last().map(|(l, _)| *l).unwrap_or(0);
    let (blob_lit, blob_total, lens, len_ty) = key_blob(&keys);

    let eq_arms = buckets.iter().map(|(len, idxs)| {
        let checks = idxs.iter().map(|&i| {
            let check = eq_check(&keys, i);
            quote! {
                if #check {
                    return true;
                }
            }
        });
        quote! {
            #len => { #(#checks)* false }
        }
    });

    let decl_keys = (0..n).map(|i| key_lit(&keys, i));

    Ok(quote! {
        #(#attrs)*
        #vis static #name: #ty_name = #ty_name(());

        #[doc(hidden)]
        #[allow(non_camel_case_types)]
        #vis struct #ty_name(());

        #[doc(hidden)]
        static #blob_name: [u8; #blob_total] = *#blob_lit;
        #[doc(hidden)]
        static #lens_name: [#len_ty; #n] = [ #(#lens),* ];

        #[allow(dead_code)]
        impl #ty_name {
            #vis const MIN_LEN: usize = #min_len;
            #vis const MAX_LEN: usize = #max_len;
            /// Keys in declaration order, for `const` contexts. Referencing
            /// this materializes a pointer-per-key table at the use site —
            /// runtime callers should use `iter()`, which reads the
            /// pointer-free blob.
            #vis const KEYS: &'static [&'static [u8]] = &[ #(#decl_keys),* ];

            #[inline]
            #vis fn contains(&self, key: &[u8]) -> bool {
                match key.len() {
                    #(#eq_arms)*
                    _ => false,
                }
            }

            #vis fn len(&self) -> usize {
                #n
            }

            #vis fn iter(&self) -> impl Iterator<Item = &'static [u8]> {
                let mut off = 0usize;
                #lens_name.iter().map(move |len| {
                    let len = *len as usize;
                    let key = &#blob_name[off..off + len];
                    off += len;
                    key
                })
            }
        }
    })
}
