//! `#[imports]`: an `extern` block of functions of the host OS, as functions that call through the image's
//! import table.

use proc_macro2::{Delimiter, Group, Ident, Literal, Span, TokenStream as Tokens, TokenTree};
use quote::{format_ident, quote};

use crate::{Cursor, attribute_name, attribute_tokens, per_architecture, string_value};

struct Function {
    attributes: Vec<Group>,
    visibility: Tokens,
    is_safe: bool,
    name: Ident,
    symbol: String,
    /// The library of this function, when it is not the one of the block.
    library: Option<String>,
    arguments: Vec<Argument>,
    result: Tokens,
}

struct Argument {
    name: Ident,
    ty: Tokens,
}

pub(crate) fn expand(args: Tokens, item: Tokens) -> syn::Result<Tokens> {
    let mut cursor = Cursor::new(item, Span::call_site());
    let block_attributes = cursor.take_attributes()?;

    let mut library = string_value(args.clone(), "library");
    if library.is_none() && !args.is_empty() {
        return Err(syn::Error::new(
            Span::call_site(),
            "expected `library = \"name\"`",
        ));
    }
    let mut kept_attributes = Vec::new();
    for attribute in &block_attributes {
        match link_name_of_block(attribute) {
            Some(name) => {
                library.get_or_insert(name);
            }
            None => kept_attributes.push(attribute_tokens(attribute)),
        }
    }
    let Some(library) = library else {
        return Err(syn::Error::new(
            Span::call_site(),
            "this block has no `link(name = \"..\")`: name the library, `imports(library = \"..\")`",
        ));
    };

    cursor.take_ident("unsafe");
    if cursor.take_ident("extern").is_none() {
        return Err(cursor.error("expected an `extern` block"));
    }
    if let Some(TokenTree::Literal(abi)) = cursor.peek() {
        let abi = abi.to_string();
        if abi != "\"C\"" && abi != "\"system\"" {
            return Err(cursor
                .error("the functions of the host OS are `extern \"system\"` or `extern \"C\"`"));
        }
        cursor.next();
    }
    let Some(body) = cursor.take_group(Delimiter::Brace) else {
        return Err(cursor.error("expected the body of the `extern` block"));
    };
    if !cursor.is_done() {
        return Err(cursor.error("unexpected tokens after the `extern` block"));
    }

    let mut functions = Cursor::new(body.stream(), body.span_close());
    let mut out = Tokens::new();
    while !functions.is_done() {
        let function = parse_function(&mut functions)?;
        out.extend(per_architecture(wrapper(
            &function,
            &library,
            &kept_attributes,
        )));
    }
    Ok(out)
}

/// The library of `link(name = "..")` or of `cfg_attr(.., link(name = ".."))`.
fn link_name_of_block(attribute: &Group) -> Option<String> {
    let mut tokens = attribute.stream().into_iter();
    let TokenTree::Ident(name) = tokens.next()? else {
        return None;
    };
    let TokenTree::Group(arguments) = tokens.next()? else {
        return None;
    };
    if name == "link" {
        return string_value(arguments.stream(), "name");
    }
    if name != "cfg_attr" {
        return None;
    }
    let inner: Vec<TokenTree> = arguments.stream().into_iter().collect();
    inner.windows(2).find_map(|window| match window {
        [TokenTree::Ident(name), TokenTree::Group(arguments)] if name == "link" => {
            string_value(arguments.stream(), "name")
        }
        _ => None,
    })
}

/// `#[cfg_attr(bun_portable, library = "..")]` on a function of the block. The attributes inside of an
/// item are not evaluated before an attribute macro on the item runs, so it arrives as it is written.
fn library_of_function(attribute: &Group) -> Option<String> {
    if attribute_name(attribute).as_deref() != Some("cfg_attr") {
        return None;
    }
    let TokenTree::Group(arguments) = attribute.stream().into_iter().nth(1)? else {
        return None;
    };
    let mut tokens = arguments.stream().into_iter();
    match tokens.next()? {
        TokenTree::Ident(predicate) if predicate == "bun_portable" => {}
        _ => return None,
    }
    string_value(tokens.skip(1).collect(), "library")
}

fn parse_function(cursor: &mut Cursor) -> syn::Result<Function> {
    let mut symbol = None;
    let mut library = None;
    let mut attributes = Vec::new();
    for attribute in cursor.take_attributes()? {
        if attribute_name(&attribute).as_deref() == Some("link_name") {
            symbol = string_value(attribute.stream(), "link_name");
        } else if let Some(name) = library_of_function(&attribute) {
            library = Some(name);
        } else {
            attributes.push(attribute);
        }
    }

    let mut visibility = Tokens::new();
    if let Some(keyword) = cursor.take_ident("pub") {
        visibility.extend([TokenTree::Ident(keyword)]);
        if let Some(restriction) = cursor.take_group(Delimiter::Parenthesis) {
            visibility.extend([TokenTree::Group(restriction)]);
        }
    }

    let is_safe = cursor.take_ident("safe").is_some();
    if !is_safe {
        cursor.take_ident("unsafe");
    }
    if cursor.take_ident("fn").is_none() {
        return Err(cursor.error("only functions can be imported from the host OS"));
    }
    let Some(TokenTree::Ident(name)) = cursor.next() else {
        return Err(cursor.error("expected the name of the function"));
    };
    let Some(parameters) = cursor.take_group(Delimiter::Parenthesis) else {
        return Err(cursor.error(
            "expected the arguments of the function (generic functions cannot be imported)",
        ));
    };
    let arguments = parse_arguments(parameters)?;

    let mut result = Tokens::new();
    loop {
        match cursor.next() {
            Some(TokenTree::Punct(punct)) if punct.as_char() == ';' => break,
            Some(token) => result.extend([token]),
            None => return Err(cursor.error("expected `;` after the function")),
        }
    }

    Ok(Function {
        attributes,
        visibility,
        is_safe,
        symbol: symbol.unwrap_or_else(|| name.to_string()),
        library,
        name,
        arguments,
        result,
    })
}

fn parse_arguments(parameters: Group) -> syn::Result<Vec<Argument>> {
    let mut arguments = Vec::new();
    let mut current = Vec::new();
    let mut angle_depth = 0usize;
    let mut previous_was_minus = false;
    let flush = |current: &mut Vec<TokenTree>, arguments: &mut Vec<Argument>| -> syn::Result<()> {
        if current.is_empty() {
            return Ok(());
        }
        let index = arguments.len();
        arguments.push(parse_argument(core::mem::take(current), index)?);
        Ok(())
    };
    for token in parameters.stream() {
        if let TokenTree::Punct(punct) = &token {
            match punct.as_char() {
                '<' => angle_depth += 1,
                '>' if !previous_was_minus => angle_depth = angle_depth.saturating_sub(1),
                ',' if angle_depth == 0 => {
                    flush(&mut current, &mut arguments)?;
                    previous_was_minus = false;
                    continue;
                }
                _ => {}
            }
            previous_was_minus = punct.as_char() == '-';
        } else {
            previous_was_minus = false;
        }
        current.push(token);
    }
    flush(&mut current, &mut arguments)?;
    Ok(arguments)
}

fn parse_argument(tokens: Vec<TokenTree>, index: usize) -> syn::Result<Argument> {
    let span = tokens[0].span();
    if matches!(&tokens[0], TokenTree::Punct(punct) if punct.as_char() == '.') {
        return Err(syn::Error::new(
            span,
            "a variadic function cannot be called through the import table",
        ));
    }
    let colon = tokens
        .iter()
        .position(|token| matches!(token, TokenTree::Punct(punct) if punct.as_char() == ':'));
    let Some(colon) = colon else {
        return Err(syn::Error::new(span, "expected `name: Type`"));
    };
    let name = match &tokens[..colon] {
        [TokenTree::Ident(name)] if name != "_" => name.clone(),
        _ => format_ident!("argument_{}", index, span = span),
    };
    Ok(Argument {
        name,
        ty: tokens[colon + 1..].iter().cloned().collect(),
    })
}

fn wrapper(function: &Function, library: &str, block_attributes: &[Tokens]) -> Tokens {
    let Function {
        attributes,
        visibility,
        is_safe,
        name,
        symbol,
        library: own_library,
        arguments,
        result,
    } = function;
    let library = own_library.as_deref().unwrap_or(library);
    let attributes = attributes.iter().map(attribute_tokens);
    let unsafety = if *is_safe { quote!() } else { quote!(unsafe) };
    let names: Vec<&Ident> = arguments.iter().map(|argument| &argument.name).collect();
    let types: Vec<&Tokens> = arguments.iter().map(|argument| &argument.ty).collect();
    let library = nul_terminated(library);
    let symbol = nul_terminated(symbol);
    quote! {
        #(#block_attributes)*
        #(#attributes)*
        #[inline]
        #[allow(clippy::too_many_arguments, clippy::missing_safety_doc, non_snake_case)]
        #visibility #unsafety fn #name(#(#names: #types),*) #result {
            #[unsafe(link_section = "bun_imports")]
            static IMPORT: ::bun_windows_sys::host_imports::Import =
                ::bun_windows_sys::host_imports::Import::new(#library, #symbol);
            // SAFETY: `address` returns the address the host resolved for this symbol, or does not return.
            // The function behind it has the signature of the declaration this was made from, and the
            // caller keeps that declaration's contract.
            unsafe {
                ::core::mem::transmute::<
                    *mut ::core::ffi::c_void,
                    unsafe extern "C" fn(#(#types),*) #result,
                >(IMPORT.address())(#(#names),*)
            }
        }
    }
}

fn nul_terminated(text: &str) -> Literal {
    let mut bytes = text.as_bytes().to_vec();
    bytes.push(0);
    Literal::byte_string(&bytes)
}
