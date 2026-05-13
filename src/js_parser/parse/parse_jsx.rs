#![allow(unused_imports, unused_variables, dead_code, unused_mut)]
#![warn(unused_must_use)]
use crate::lexer::{self as js_lexer, T};
use crate::p::P;
use crate::parser::{JSXTag, JSXTagData, options};
use bun_ast::expr::Data as ExprData;
use bun_ast::flags;
use bun_ast::op::Level;
use bun_ast::{self as js_ast, E, Expr, ExprNodeIndex, ExprNodeList, G};
use bun_collections::VecExt;
use bun_core::err;
use bun_core::strings;

// Zig: `pub fn ParseJSXElement(comptime ...) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`
// (sealed trait + ZST), so this becomes a direct `impl` on `P` instead of a wrapper struct.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub fn parse_jsx_element(&mut self, loc: bun_ast::Loc) -> Result<Expr, bun_core::Error> {
        let p = self;
        if SCAN_ONLY {
            p.needs_jsx_import = true;
        }

        let tag = JSXTag::parse(p)?;

        // The tag may have TypeScript type arguments: "<Foo<T>/>"
        if TYPESCRIPT {
            // Pass a flag to the type argument skipper because we need to call
            let _ = p.skip_type_script_type_arguments::<true>()?;
        }

        let mut previous_string_with_backslash_loc = bun_ast::Loc::default();
        let mut properties = bun_alloc::AstAlloc::vec();
        let mut key_prop_i: i32 = -1;
        let mut flags = flags::JSXElementBitset::empty();
        let mut start_tag: Option<ExprNodeIndex> = None;
        let mut can_be_inlined = false;

        // Fragments don't have props
        // Fragments of the form "React.Fragment" are not parsed as fragments.
        if let Some(t) = tag.data.as_expr() {
            start_tag = Some(t);
            can_be_inlined = p.options.features.jsx_optimization_inline;

            let mut spread_loc: bun_ast::Loc = bun_ast::Loc::EMPTY;
            let mut props: Vec<G::Property> = Vec::new();
            let mut first_spread_prop_i: i32 = -1;
            let mut i: i32 = 0;
            'parse_attributes: loop {
                match p.lexer.token {
                    T::TIdentifier => {
                        // PORT NOTE: `defer i += 1` inlined at each exit point of this arm.
                        // Parse the prop name
                        let key_range = p.lexer.range();
                        let prop_name_literal = p.lexer.identifier;
                        let special_prop = E::JSXSpecialProp::from_bytes(prop_name_literal)
                            .unwrap_or(E::JSXSpecialProp::Any);
                        p.lexer.next_inside_jsx_element()?;

                        if special_prop == E::JSXSpecialProp::Key {
                            // <ListItem key>
                            if p.lexer.token != T::TEquals {
                                // Unlike Babel, we're going to just warn here and move on.
                                p.log().add_warning(
                                    Some(p.source),
                                    key_range.loc,
                                    b"\"key\" prop ignored. Must be a string, number or symbol.",
                                );
                                i += 1; // defer i += 1
                                continue;
                            }

                            key_prop_i = i;
                        }

                        let prop_name =
                            p.new_expr(E::EString::init(prop_name_literal), key_range.loc);

                        // Parse the value
                        let value: Expr = if p.lexer.token != T::TEquals {
                            // Implicitly true value
                            // <button selected>
                            p.new_expr(
                                E::Boolean { value: true },
                                bun_ast::Loc {
                                    start: key_range.loc.start + key_range.len,
                                },
                            )
                        } else {
                            can_be_inlined = false;
                            p.parse_jsx_prop_value_identifier(
                                &mut previous_string_with_backslash_loc,
                            )?
                        };

                        props.push(G::Property {
                            key: Some(prop_name),
                            value: Some(value),
                            ..Default::default()
                        });
                        i += 1; // defer i += 1
                    }
                    T::TOpenBrace => {
                        // PORT NOTE: `defer i += 1` inlined at end of this arm.
                        // Use Next() not ExpectInsideJSXElement() so we can parse "..."
                        p.lexer.next()?;

                        match p.lexer.token {
                            T::TDotDotDot => {
                                p.lexer.next()?;
                                can_be_inlined = false;

                                if first_spread_prop_i == -1 {
                                    first_spread_prop_i = i;
                                }
                                spread_loc = p.lexer.loc();
                                let value = p.parse_expr(Level::Comma)?;
                                props.push(G::Property {
                                    value: Some(value),
                                    kind: G::PropertyKind::Spread,
                                    ..Default::default()
                                });
                            }
                            // This implements
                            //  <div {foo} />
                            //  ->
                            //  <div foo={foo} />
                            T::TIdentifier => {
                                can_be_inlined = false;

                                // we need to figure out what the key they mean is
                                // to do that, we must determine the key name
                                let expr = p.parse_expr(Level::Lowest)?;

                                let key = 'brk: {
                                    match &expr.data {
                                        ExprData::EImportIdentifier(ident) => {
                                            break 'brk p.new_expr(
                                                E::EString::init(p.load_name_from_ref(ident.ref_)),
                                                expr.loc,
                                            );
                                        }
                                        ExprData::ECommonjsExportIdentifier(ident) => {
                                            break 'brk p.new_expr(
                                                E::EString::init(p.load_name_from_ref(ident.ref_)),
                                                expr.loc,
                                            );
                                        }
                                        ExprData::EIdentifier(ident) => {
                                            break 'brk p.new_expr(
                                                E::EString::init(p.load_name_from_ref(ident.ref_)),
                                                expr.loc,
                                            );
                                        }
                                        ExprData::EDot(dot) => {
                                            break 'brk p.new_expr(
                                                E::EString::init(&dot.name),
                                                dot.name_loc,
                                            );
                                        }
                                        ExprData::EIndex(index) => {
                                            if matches!(index.index.data, ExprData::EString(_)) {
                                                break 'brk index.index;
                                            }
                                        }
                                        _ => {}
                                    }

                                    // If we get here, it's invalid
                                    p.log().add_error(
                                        Some(p.source),
                                        expr.loc,
                                        b"Invalid JSX prop shorthand, must be identifier, dot or string",
                                    );
                                    return Err(err!("SyntaxError"));
                                };

                                props.push(G::Property {
                                    value: Some(expr),
                                    key: Some(key),
                                    kind: G::PropertyKind::Normal,
                                    ..Default::default()
                                });
                            }
                            // This implements
                            //  <div {"foo"} />
                            //  <div {'foo'} />
                            //  ->
                            //  <div foo="foo" />
                            // note: template literals are not supported, operations on strings are not supported either
                            T::TStringLiteral => {
                                let key_loc = p.lexer.loc();
                                let key_str = p.lexer.to_e_string()?;
                                let key = p.new_expr(key_str, key_loc);
                                p.lexer.next()?;
                                props.push(G::Property {
                                    value: Some(key),
                                    key: Some(key),
                                    kind: G::PropertyKind::Normal,
                                    ..Default::default()
                                });
                            }

                            _ => p.lexer.unexpected()?,
                        }

                        p.lexer.next_inside_jsx_element()?;
                        i += 1; // defer i += 1
                    }
                    _ => {
                        break 'parse_attributes;
                    }
                }
            }

            let is_key_after_spread =
                key_prop_i > -1 && first_spread_prop_i > -1 && key_prop_i > first_spread_prop_i;
            if is_key_after_spread {
                flags.insert(flags::JSXElement::IsKeyAfterSpread);
            }
            properties = G::PropertyList::move_from_list(props);
            if is_key_after_spread
                && p.options.jsx.runtime == options::JSXRuntime::Automatic
                && !p.has_classic_runtime_warned
            {
                p.log().add_warning(
                    Some(p.source),
                    spread_loc,
                    b"\"key\" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.",
                );
                p.has_classic_runtime_warned = true;
            }
        }

        // People sometimes try to use the output of "JSON.stringify()" as a JSX
        // attribute when automatically-generating JSX code. Doing so is incorrect
        // because JSX strings work like XML instead of like JS (since JSX is XML-in-
        // JS). Specifically, using a backslash before a quote does not cause it to
        // be escaped:
        //
        //   JSX ends the "content" attribute here and sets "content" to 'some so-called \\'
        //                                          v
        //         <Button content="some so-called \"button text\"" />
        //                                                      ^
        //       There is no "=" after the JSX attribute "text", so we expect a ">"
        //
        // This code special-cases this error to provide a less obscure error message.
        if p.lexer.token == T::TSyntaxError
            && p.lexer.raw() == b"\\"
            && previous_string_with_backslash_loc.start > 0
        {
            let r = p.lexer.range();
            // Not dealing with this right now.
            p.log().add_range_error(
                Some(p.source),
                r,
                b"Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead",
            );
            return Err(err!("SyntaxError"));
        }

        // A slash here is a self-closing element
        if p.lexer.token == T::TSlash {
            let close_tag_loc = p.lexer.loc();
            // Use NextInsideJSXElement() not Next() so we can parse ">>" as ">"

            p.lexer.next_inside_jsx_element()?;

            if p.lexer.token != T::TGreaterThan {
                p.lexer.expected(T::TGreaterThan)?;
            }

            return Ok(p.new_expr(
                E::JSXElement {
                    tag: start_tag,
                    properties,
                    key_prop_index: key_prop_i,
                    flags,
                    close_tag_loc,
                    ..Default::default()
                },
                loc,
            ));
        }

        // Use ExpectJSXElementChild() so we parse child strings
        p.lexer.expect_jsx_element_child(T::TGreaterThan)?;
        let mut children: Vec<Expr> = Vec::new();
        // var last_element_i: usize = 0;

        loop {
            match p.lexer.token {
                T::TStringLiteral => {
                    let e_string = p.lexer.to_e_string()?;
                    children.push(p.new_expr(e_string, loc));
                    p.lexer.next_jsx_element_child()?;
                }
                T::TOpenBrace => {
                    // Use Next() instead of NextJSXElementChild() here since the next token is an expression
                    p.lexer.next()?;

                    let is_spread = p.lexer.token == T::TDotDotDot;
                    if is_spread {
                        p.lexer.next()?;
                    }

                    // The expression is optional, and may be absent
                    if p.lexer.token != T::TCloseBrace {
                        if can_be_inlined {
                            can_be_inlined = false;
                        }

                        let mut item = p.parse_expr(Level::Lowest)?;
                        if is_spread {
                            item = p.new_expr(E::Spread { value: item }, loc);
                        }
                        children.push(item);
                    }

                    // Use ExpectJSXElementChild() so we parse child strings
                    p.lexer.expect_jsx_element_child(T::TCloseBrace)?;
                }
                T::TLessThan => {
                    let less_than_loc = p.lexer.loc();
                    p.lexer.next_inside_jsx_element()?;

                    if p.lexer.token != T::TSlash {
                        // This is a child element

                        let child = Self::parse_jsx_element(p, less_than_loc)?;
                        children.push(child);
                        // PERF(port): was `catch unreachable` on append — Vec::push is infallible

                        // The call to parseJSXElement() above doesn't consume the last
                        // TGreaterThan because the caller knows what Next() function to call.
                        // Use NextJSXElementChild() here since the next token is an element
                        // child.
                        p.lexer.next_jsx_element_child()?;
                        continue;
                    }

                    // This is the closing element
                    p.lexer.next_inside_jsx_element()?;
                    let end_tag = JSXTag::parse(p)?;

                    if end_tag.name != tag.name {
                        // TODO(port): arena param dropped from Zig signature.
                        p.log().add_range_error_fmt_with_note(
                            Some(p.source),
                            end_tag.range,
                            format_args!(
                                "Expected closing JSX tag to match opening tag \"\\<{}\\>\"",
                                bstr::BStr::new(tag.name)
                            ),
                            format_args!("Opening tag here:"),
                            tag.range,
                        );
                        return Err(err!("SyntaxError"));
                    }

                    if p.lexer.token != T::TGreaterThan {
                        p.lexer.expected(T::TGreaterThan)?;
                    }

                    return Ok(p.new_expr(
                        E::JSXElement {
                            tag: end_tag.data.as_expr(),
                            children: ExprNodeList::move_from_list(children),
                            properties,
                            key_prop_index: key_prop_i,
                            flags,
                            close_tag_loc: end_tag.range.loc,
                            ..Default::default()
                        },
                        loc,
                    ));
                }
                _ => {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }
            }
        }
    }
}

// ported from: src/js_parser/ast/parseJSXElement.zig
