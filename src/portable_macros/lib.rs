//! Attribute macros of the portable image (`cfg(bun_portable)`): one image per processor, compiled for a
//! Linux target, that runs bun's code for Linux, macOS and Windows and picks by the host OS at run time.
//!
//! Each attribute is written `#[cfg_attr(bun_portable, ...)]` where it is used. In a build for one OS the
//! attribute does not exist, and the item is compiled as it is written.
//!
//! - [`imports`]: an `extern` block of functions of the host OS becomes functions with the same names and
//!   signatures that call through addresses the host resolved.
//! - [`win_abi`]: what Windows calls, and the types of pointers to it, get the calling convention of Windows.
//! - [`host_os`]: one of several definitions of a function, each for one host OS, and the function that picks.

use proc_macro::TokenStream;
use proc_macro2::{Delimiter, Group, Ident, Literal, Punct, Spacing, Span, TokenStream as Tokens, TokenTree};
use quote::{ToTokens, quote};

mod host_os;
mod imports;

/// On an `unsafe extern "system" { .. }` or `unsafe extern "C" { .. }` block.
///
/// `#[cfg_attr(bun_portable, bun_portable_macros::imports)]` takes the library from the block's
/// `link(name = "..")`; a block that has none names it: `imports(library = "libuv")`.
///
/// Every `fn` of the block becomes a function of the same name, visibility, arguments and result, `unsafe`
/// unless it was declared `safe`. It calls the address in its entry of the image's import table
/// (`bun_windows_sys::host_imports`), with the calling convention of Windows.
#[proc_macro_attribute]
pub fn imports(args: TokenStream, item: TokenStream) -> TokenStream {
    imports::expand(args.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}

/// On a function that Windows or libuv calls, or on a type, a field or an item that names the type of a
/// pointer to such a function: every `extern "C" fn` and `extern "system" fn` in it is `extern "win64" fn`
/// on x86-64. On arm64 the two conventions agree for functions that are not variadic, and nothing changes.
///
/// `extern` blocks inside the item are left alone: what they declare is linked into the image.
#[proc_macro_attribute]
pub fn win_abi(args: TokenStream, item: TokenStream) -> TokenStream {
    if !args.is_empty() {
        return syn::Error::new(Span::call_site(), "win_abi takes no arguments")
            .into_compile_error()
            .into();
    }
    per_architecture(item.into()).into()
}

/// On a function or a method that has one definition for each host OS.
///
/// ```ignore
/// #[cfg(not(windows))]
/// #[cfg_attr(bun_portable, bun_portable_macros::host_os(posix))]
/// pub fn copy_file(from: Fd, to: Fd) -> Maybe<()> { .. }
///
/// #[cfg(any(windows, bun_portable))]
/// #[cfg_attr(bun_portable, bun_portable_macros::host_os(windows, dispatch(posix, windows)))]
/// pub fn copy_file(from: Fd, to: Fd) -> Maybe<()> { .. }
/// ```
///
/// The function is renamed `<name>__<os>`. With `dispatch(..)`, which the last definition carries, the
/// function `<name>` is added: it calls the definition for the host OS (`bun_core::host`). The kinds are
/// `windows`, `macos`, `linux`, and `posix` for every host that is not Windows.
#[proc_macro_attribute]
pub fn host_os(args: TokenStream, item: TokenStream) -> TokenStream {
    host_os::expand(args.into(), item.into())
        .unwrap_or_else(syn::Error::into_compile_error)
        .into()
}

/// The item for x86-64 with the calling convention of Windows, and as it is for every other processor.
fn per_architecture(item: Tokens) -> Tokens {
    let windows = with_windows_abi(item.clone());
    quote! {
        #[cfg(target_arch = "x86_64")]
        #windows
        #[cfg(not(target_arch = "x86_64"))]
        #item
    }
}

/// Replaces the ABI of every `extern ".." fn` whose ABI is the platform's C convention.
fn with_windows_abi(stream: Tokens) -> Tokens {
    let mut out = Tokens::new();
    let mut tokens = stream.into_iter().peekable();
    while let Some(token) = tokens.next() {
        match token {
            TokenTree::Group(group) => {
                let mut rewritten = Group::new(group.delimiter(), with_windows_abi(group.stream()));
                rewritten.set_span(group.span());
                out.extend([TokenTree::Group(rewritten)]);
            }
            TokenTree::Ident(ref keyword) if keyword == "extern" => {
                let span = keyword.span();
                out.extend([token]);
                match tokens.peek() {
                    Some(TokenTree::Ident(next)) if next == "fn" => {
                        out.extend([abi_literal("win64", span)]);
                    }
                    Some(TokenTree::Literal(abi)) => {
                        let replacement = match abi.to_string().as_str() {
                            "\"C\"" | "\"system\"" => Some("win64"),
                            "\"C-unwind\"" | "\"system-unwind\"" => Some("win64-unwind"),
                            _ => None,
                        };
                        let abi = tokens.next().expect("peeked");
                        let declares_function =
                            matches!(tokens.peek(), Some(TokenTree::Ident(next)) if next == "fn");
                        match replacement {
                            Some(name) if declares_function => {
                                out.extend([abi_literal(name, abi.span())]);
                            }
                            _ => out.extend([abi]),
                        }
                    }
                    _ => {}
                }
            }
            other => out.extend([other]),
        }
    }
    out
}

fn abi_literal(name: &str, span: Span) -> TokenTree {
    let mut literal = Literal::string(name);
    literal.set_span(span);
    TokenTree::Literal(literal)
}

/// A cursor over the tokens of one delimited group.
struct Cursor {
    tokens: Vec<TokenTree>,
    at: usize,
    end: Span,
}

impl Cursor {
    fn new(stream: Tokens, end: Span) -> Cursor {
        Cursor {
            tokens: stream.into_iter().collect(),
            at: 0,
            end,
        }
    }

    fn peek(&self) -> Option<&TokenTree> {
        self.tokens.get(self.at)
    }

    fn next(&mut self) -> Option<TokenTree> {
        let token = self.tokens.get(self.at).cloned();
        self.at += token.is_some() as usize;
        token
    }

    fn is_done(&self) -> bool {
        self.at >= self.tokens.len()
    }

    fn span(&self) -> Span {
        self.peek().map_or(self.end, TokenTree::span)
    }

    fn error(&self, message: &str) -> syn::Error {
        syn::Error::new(self.span(), message)
    }

    fn peek_ident(&self, name: &str) -> bool {
        matches!(self.peek(), Some(TokenTree::Ident(ident)) if ident == name)
    }

    fn peek_punct(&self, character: char) -> bool {
        matches!(self.peek(), Some(TokenTree::Punct(punct)) if punct.as_char() == character)
    }

    fn take_ident(&mut self, name: &str) -> Option<Ident> {
        if !self.peek_ident(name) {
            return None;
        }
        match self.next() {
            Some(TokenTree::Ident(ident)) => Some(ident),
            _ => None,
        }
    }

    fn take_group(&mut self, delimiter: Delimiter) -> Option<Group> {
        match self.peek() {
            Some(TokenTree::Group(group)) if group.delimiter() == delimiter => {}
            _ => return None,
        }
        match self.next() {
            Some(TokenTree::Group(group)) => Some(group),
            _ => None,
        }
    }

    /// `#[..]` attributes, each as the tokens inside of its brackets.
    fn take_attributes(&mut self) -> syn::Result<Vec<Group>> {
        let mut attributes = Vec::new();
        while self.peek_punct('#') {
            self.next();
            let Some(group) = self.take_group(Delimiter::Bracket) else {
                return Err(self.error("expected `[` after `#`"));
            };
            attributes.push(group);
        }
        Ok(attributes)
    }
}

fn attribute_tokens(attribute: &Group) -> Tokens {
    let mut tokens = Tokens::new();
    tokens.extend([TokenTree::Punct(Punct::new('#', Spacing::Alone))]);
    tokens.extend([TokenTree::Group(attribute.clone())]);
    tokens
}

/// The first identifier of an attribute: `cfg` of `#[cfg(windows)]`.
fn attribute_name(attribute: &Group) -> Option<String> {
    match attribute.stream().into_iter().next() {
        Some(TokenTree::Ident(ident)) => Some(ident.to_string()),
        _ => None,
    }
}

/// The value of `key = ".."` directly in these tokens.
fn string_value(stream: Tokens, key: &str) -> Option<String> {
    let tokens: Vec<TokenTree> = stream.into_iter().collect();
    tokens.windows(3).find_map(|window| match window {
        [TokenTree::Ident(name), TokenTree::Punct(equals), TokenTree::Literal(value)]
            if name == key && equals.as_char() == '=' =>
        {
            syn::parse2::<syn::LitStr>(value.to_token_stream())
                .ok()
                .map(|literal| literal.value())
        }
        _ => None,
    })
}
