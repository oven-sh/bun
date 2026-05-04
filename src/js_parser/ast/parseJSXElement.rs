use bun_js_parser::{self as js_parser, JSXTag, JSXTransformType, NewParser_};
use bun_js_parser::ast::{self as js_ast, E, Expr, ExprNodeIndex, ExprNodeList, Flags, G, Op};
use bun_js_parser::ast::Op::Level;
use bun_js_parser::lexer::{self as js_lexer, T};
use bun_logger as logger;
use bun_str::strings;
use bun_core::err;

// TODO(port): `Expr::Data` variant path is assumed; fix to actual enum path in Phase B.
use bun_js_parser::ast::expr::Data as ExprData;

/// Zig: `pub fn ParseJSXElement(comptime ...) type { return struct { ... } }`
/// Type-returning comptime fn → zero-sized generic struct with associated fns.
pub struct ParseJSXElement<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

// Local alias mirroring Zig `const P = js_parser.NewParser_(...)`.
type P<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
> = NewParser_<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>;

impl<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
> ParseJSXElement<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    const IS_TYPESCRIPT_ENABLED: bool =
        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::IS_TYPESCRIPT_ENABLED;
    const ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT: bool =
        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT;

    pub fn parse_jsx_element(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
    ) -> Result<Expr, bun_core::Error> {
        if Self::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT {
            p.needs_jsx_import = true;
        }

        let tag = JSXTag::parse(p)?;

        // The tag may have TypeScript type arguments: "<Foo<T>/>"
        if Self::IS_TYPESCRIPT_ENABLED {
            // Pass a flag to the type argument skipper because we need to call
            let _ = p.skip_type_script_type_arguments(true)?;
        }

        let mut previous_string_with_backslash_loc = logger::Loc::default();
        let mut properties = G::Property::List::default();
        let mut key_prop_i: i32 = -1;
        let mut flags = Flags::JSXElement::Bitset::empty();
        let mut start_tag: Option<ExprNodeIndex> = None;

        // Fragments don't have props
        // Fragments of the form "React.Fragment" are not parsed as fragments.
        if let JSXTag::Data::Tag(t) = &tag.data {
            start_tag = Some(*t);

            let mut spread_loc: logger::Loc = logger::Loc::EMPTY;
            let mut props = bumpalo::collections::Vec::<G::Property>::new_in(p.bump);
            let mut first_spread_prop_i: i32 = -1;
            let mut i: i32 = 0;
            'parse_attributes: loop {
                match p.lexer.token {
                    T::TIdentifier => {
                        // PORT NOTE: `defer i += 1` inlined at each exit point of this arm.
                        // Parse the prop name
                        let key_range = p.lexer.range();
                        let prop_name_literal = p.lexer.identifier;
                        let special_prop = E::JSXElement::SpecialProp::MAP
                            .get(prop_name_literal)
                            .copied()
                            .unwrap_or(E::JSXElement::SpecialProp::Any);
                        p.lexer.next_inside_jsx_element()?;

                        if special_prop == E::JSXElement::SpecialProp::Key {
                            // <ListItem key>
                            if p.lexer.token != T::TEquals {
                                // Unlike Babel, we're going to just warn here and move on.
                                p.log.add_warning(
                                    p.source,
                                    key_range.loc,
                                    "\"key\" prop ignored. Must be a string, number or symbol.",
                                )?;
                                i += 1; // defer i += 1
                                continue;
                            }

                            key_prop_i = i;
                        }

                        let prop_name =
                            p.new_expr(E::String { data: prop_name_literal }, key_range.loc);

                        // Parse the value
                        let value: Expr = if p.lexer.token != T::TEquals {
                            // Implicitly true value
                            // <button selected>
                            p.new_expr(
                                E::Boolean { value: true },
                                logger::Loc { start: key_range.loc.start + key_range.len },
                            )
                        } else {
                            p.parse_jsx_prop_value_identifier(
                                &mut previous_string_with_backslash_loc,
                            )?
                        };

                        props.push(G::Property { key: Some(prop_name), value: Some(value), ..Default::default() });
                        i += 1; // defer i += 1
                    }
                    T::TOpenBrace => {
                        // PORT NOTE: `defer i += 1` inlined at end of this arm.
                        // Use Next() not ExpectInsideJSXElement() so we can parse "..."
                        p.lexer.next()?;

                        match p.lexer.token {
                            T::TDotDotDot => {
                                p.lexer.next()?;

                                if first_spread_prop_i == -1 {
                                    first_spread_prop_i = i;
                                }
                                spread_loc = p.lexer.loc();
                                props.push(G::Property {
                                    value: Some(p.parse_expr(Level::Comma)?),
                                    kind: G::Property::Kind::Spread,
                                    ..Default::default()
                                });
                            }
                            // This implements
                            //  <div {foo} />
                            //  ->
                            //  <div foo={foo} />
                            T::TIdentifier => {
                                // we need to figure out what the key they mean is
                                // to do that, we must determine the key name
                                let expr = p.parse_expr(Level::Lowest)?;

                                let key = 'brk: {
                                    match &expr.data {
                                        ExprData::EImportIdentifier(ident) => {
                                            break 'brk p.new_expr(
                                                E::String { data: p.load_name_from_ref(ident.ref_) },
                                                expr.loc,
                                            );
                                        }
                                        ExprData::ECommonjsExportIdentifier(ident) => {
                                            break 'brk p.new_expr(
                                                E::String { data: p.load_name_from_ref(ident.ref_) },
                                                expr.loc,
                                            );
                                        }
                                        ExprData::EIdentifier(ident) => {
                                            break 'brk p.new_expr(
                                                E::String { data: p.load_name_from_ref(ident.ref_) },
                                                expr.loc,
                                            );
                                        }
                                        ExprData::EDot(dot) => {
                                            break 'brk p.new_expr(
                                                E::String { data: dot.name },
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
                                    p.log.add_error(
                                        p.source,
                                        expr.loc,
                                        "Invalid JSX prop shorthand, must be identifier, dot or string",
                                    )?;
                                    return Err(err!("SyntaxError"));
                                };

                                props.push(G::Property {
                                    value: Some(expr),
                                    key: Some(key),
                                    kind: G::Property::Kind::Normal,
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
                                let key = p.new_expr(p.lexer.to_e_string()?, p.lexer.loc());
                                p.lexer.next()?;
                                props.push(G::Property {
                                    value: Some(key),
                                    key: Some(key),
                                    kind: G::Property::Kind::Normal,
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
            flags.set_present(Flags::JSXElement::IsKeyAfterSpread, is_key_after_spread);
            properties = G::Property::List::move_from_list(&mut props);
            if is_key_after_spread
                && p.options.jsx.runtime == js_parser::options::JSXRuntime::Automatic
                && !p.has_classic_runtime_warned
            {
                p.log.add_warning(
                    p.source,
                    spread_loc,
                    "\"key\" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.",
                )?;
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
            p.log.add_range_error(
                p.source,
                r,
                "Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead",
            )?;
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
        let mut children = bumpalo::collections::Vec::<Expr>::new_in(p.bump);
        // var last_element_i: usize = 0;

        loop {
            match p.lexer.token {
                T::TStringLiteral => {
                    children.push(p.new_expr(p.lexer.to_e_string()?, loc));
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
                        p.log.add_range_error_fmt_with_note(
                            p.source,
                            end_tag.range,
                            // TODO(port): allocator param dropped; confirm signature in Phase B
                            format_args!(
                                "Expected closing JSX tag to match opening tag \"\\<{}\\>\"",
                                bstr::BStr::new(tag.name)
                            ),
                            format_args!("Opening tag here:"),
                            tag.range,
                        )?;
                        return Err(err!("SyntaxError"));
                    }

                    if p.lexer.token != T::TGreaterThan {
                        p.lexer.expected(T::TGreaterThan)?;
                    }

                    return Ok(p.new_expr(
                        E::JSXElement {
                            tag: end_tag.data.as_expr(),
                            children: ExprNodeList::move_from_list(&mut children),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parseJSXElement.zig (319 lines)
//   confidence: medium
//   todos:      2
//   notes:      const-generic mixin over NewParser_; `defer i += 1` inlined at arm exits; arena-backed lists → bumpalo::Vec via p.bump; Expr::Data variant paths and G::Property struct-init shape need Phase-B fixup.
// ──────────────────────────────────────────────────────────────────────────
