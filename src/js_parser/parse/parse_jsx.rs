#![warn(unused_must_use)]
use crate::lexer::T;
use crate::p::P;
use crate::parse::lists::ListKind;
use crate::parser::{JSXTag, options};
use bun_ast::expr::Data as ExprData;
use bun_ast::flags;
use bun_ast::op::Level;
use bun_ast::{E, Expr, ExprNodeIndex, ExprNodeList, G};
use bun_collections::VecExt;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub(crate) fn parse_jsx_element(&mut self, loc: bun_ast::Loc) -> crate::CrateResult<Expr> {
        let p = self;
        // Nested child elements (`<a><b><c>...`) recurse back into this function,
        // so guard the stack the same way the other recursive parse entry points do.
        if !p.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
        if SCAN_ONLY {
            p.needs_jsx_import = true;
        }

        // The name of the element that this one is a child of, empty for a fragment. Tolerant mode only.
        let parent_tag = if p.lexer.tolerant {
            p.jsx_parent_tag.take()
        } else {
            None
        };

        let tag = JSXTag::parse(p)?;

        // The tag may have TypeScript type arguments: "<Foo<T>/>"
        if TYPESCRIPT {
            // Pass a flag to the type argument skipper because we need to call
            let type_arguments = p.lexer.loc();
            // `</` is one token for TypeScript. It opens no type arguments. Nor are there any in a JavaScript file
            // (`parseJsxOpeningOrSelfClosingElementOrOpeningFragment`).
            if !(p.lexer.tolerant && p.lexer.is_less_than_slash())
                && !p.lexer.is_javascript_file()
                && p.skip_type_script_type_arguments::<true, false>()?
            {
                p.mark_type_syntax(loc, crate::sema::Mark::TypeArguments, type_arguments);
            }
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
            let saved_contexts = p.enter_list(ListKind::JsxAttributes);
            'parse_attributes: loop {
                match p.lexer.token {
                    T::TIdentifier => {
                        // `i` must be incremented whenever this arm pushes a property.
                        // The early `continue` for an ignored bare `key` prop
                        // intentionally skips the increment: no property is pushed there, so
                        // `key_prop_i`/`first_spread_prop_i` stay valid indices into `props`.
                        // Parse the prop name
                        let mut key_range = p.lexer.range();
                        let mut prop_name_literal = p.lexer.identifier;
                        let mut special_prop = E::JSXSpecialProp::from_bytes(prop_name_literal)
                            .unwrap_or(E::JSXSpecialProp::Any);
                        p.lexer.next_inside_jsx_element()?;

                        if p.lexer.tolerant {
                            // `parseJsxAttributeName`
                            let name = JSXTag::parse_namespaced_name(
                                p,
                                prop_name_literal,
                                &mut key_range,
                            )?;
                            if name.len() != prop_name_literal.len() {
                                special_prop = E::JSXSpecialProp::Any;
                            }
                            prop_name_literal = name;
                        }

                        if special_prop == E::JSXSpecialProp::Key {
                            // <ListItem key>
                            // `parseJsxAttribute`: to the type checker it is an attribute like any other, and `true`.
                            if p.lexer.token != T::TEquals && !p.lexer.tolerant {
                                // Unlike Babel, we're going to just warn here and move on.
                                p.log().add_warning(
                                    Some(p.source),
                                    key_range.loc,
                                    b"\"key\" prop ignored. Must be a string, number or symbol.",
                                );
                                continue;
                            }

                            key_prop_i = i;
                        }

                        let prop_name =
                            p.new_expr(E::EString::init(prop_name_literal), key_range.loc);

                        // Parse the value
                        let value: Option<Expr> = if p.lexer.token == T::TEquals {
                            can_be_inlined = false;
                            p.parse_jsx_prop_value_identifier(
                                &mut previous_string_with_backslash_loc,
                            )?
                        } else if p.lexer.tolerant {
                            // `parseJsxAttribute`: no `Initializer`.
                            None
                        } else {
                            // Implicitly true value
                            // <button selected>
                            Some(p.new_expr(
                                E::Boolean { value: true },
                                bun_ast::Loc {
                                    start: key_range.loc.start + key_range.len,
                                },
                            ))
                        };

                        props.push(G::Property {
                            key: Some(prop_name),
                            value,
                            ..Default::default()
                        });
                        p.mark_end(key_range.loc, crate::sema::Mark::MemberEnd);
                        i += 1;
                    }
                    T::TOpenBrace => {
                        // This arm must increment `i` once before exiting.
                        let open_brace = p.lexer.loc();
                        // Use Next() not ExpectInsideJSXElement() so we can parse "..."
                        p.lexer.next()?;

                        // `parseJsxSpreadAttribute`: TypeScript has no shorthand. It reports the missing `...` (1005).
                        let is_missing_dots = p.lexer.tolerant && p.lexer.token != T::TDotDotDot;

                        match if is_missing_dots {
                            T::TDotDotDot
                        } else {
                            p.lexer.token
                        } {
                            T::TDotDotDot => {
                                p.lexer.expect(T::TDotDotDot)?;
                                can_be_inlined = false;

                                if first_spread_prop_i == -1 {
                                    first_spread_prop_i = i;
                                }
                                spread_loc = p.lexer.loc();
                                let value = p.parse_expr(if p.lexer.tolerant {
                                    Level::Lowest
                                } else {
                                    Level::Comma
                                })?;
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
                                    return Err(crate::Error::SyntaxError);
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

                        if p.lexer.token != T::TCloseBrace && p.lexer.tolerant {
                            // `parseExpected`
                            p.lexer.expect(T::TCloseBrace)?;
                            Self::rescan_inside_jsx_element(p)?;
                        } else {
                            p.lexer.next_inside_jsx_element()?;
                        }
                        // `JsxSpreadAttribute`
                        if let Some(&G::Property {
                            key: None,
                            value: Some(Expr { loc: from, .. }),
                            ..
                        }) = props.last()
                        {
                            p.mark_type_syntax(from, crate::sema::Mark::MemberStart, open_brace);
                            p.mark_end(from, crate::sema::Mark::MemberEnd);
                        }
                        i += 1;
                    }
                    _ => {
                        if p.lexer.tolerant && Self::recover_jsx_attribute(p)? {
                            continue 'parse_attributes;
                        }
                        break 'parse_attributes;
                    }
                }
            }
            p.lexer.list_contexts = saved_contexts;

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
            && !p.lexer.tolerant
        {
            let r = p.lexer.range();
            // Not dealing with this right now.
            p.log().add_range_error(
                Some(p.source),
                r,
                b"Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead",
            );
            return Err(crate::Error::SyntaxError);
        }

        // A slash here is a self-closing element
        if p.lexer.token == T::TSlash {
            let close_tag_loc = p.lexer.loc();
            // Use NextInsideJSXElement() not Next() so we can parse ">>" as ">"

            p.lexer.next_inside_jsx_element()?;

            if p.lexer.token != T::TGreaterThan {
                p.lexer.expected(T::TGreaterThan)?;
            }
            let end = Self::end_of_jsx_tag(p);
            let syntax = p.keep_jsx(None, end, bun_ast::Loc::EMPTY, end);

            return Ok(p.new_expr(
                E::JSXElement {
                    tag: start_tag,
                    properties,
                    key_prop_index: key_prop_i,
                    flags,
                    close_tag_loc,
                    syntax,
                    ..Default::default()
                },
                loc,
            ));
        }

        if p.lexer.token != T::TGreaterThan && p.lexer.tolerant {
            // `parseJsxOpeningOrSelfClosingElementOrOpeningFragment`: 1005 for the `/`, and the element is self-closing.
            p.lexer.expected(T::TSlash)?;
            let end = Self::end_of_jsx_tag(p);
            let syntax = p.keep_jsx(None, end, bun_ast::Loc::EMPTY, end);
            return Ok(p.new_expr(
                E::JSXElement {
                    tag: start_tag,
                    properties,
                    key_prop_index: key_prop_i,
                    flags,
                    close_tag_loc: loc,
                    syntax,
                    ..Default::default()
                },
                loc,
            ));
        }

        let opening_end = Self::end_of_jsx_tag(p);
        // Use ExpectJSXElementChild() so we parse child strings
        p.lexer.expect_jsx_element_child(T::TGreaterThan)?;
        let mut children: Vec<Expr> = Vec::new();
        // var last_element_i: usize = 0;

        let saved_contexts = p.enter_list(ListKind::JsxChildren);
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
                    // `parseJsxExpression`: not after `...`, where it is missed.
                    if p.lexer.token != T::TCloseBrace || (is_spread && p.lexer.tolerant) {
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

                        if p.lexer.tolerant {
                            p.jsx_parent_tag = Some(tag.name);
                        }
                        let child = Self::parse_jsx_element(p, less_than_loc)?;
                        children.push(child);

                        if p.lexer.tolerant {
                            if let Some((end_tag, closing_start, end)) = p.jsx_adopted_close.take()
                            {
                                // The child was not closed, and met the closing tag of this element.
                                p.lexer.list_contexts = saved_contexts;
                                let closing_tag = end_tag.data.as_expr();
                                let syntax =
                                    p.keep_jsx(closing_tag, opening_end, closing_start, end);
                                return Ok(p.new_expr(
                                    E::JSXElement {
                                        tag: start_tag,
                                        children: ExprNodeList::move_from_list(children),
                                        properties,
                                        key_prop_index: key_prop_i,
                                        flags,
                                        close_tag_loc: end_tag.range.loc,
                                        syntax,
                                    },
                                    loc,
                                ));
                            }
                            if p.lexer.token != T::TGreaterThan {
                                // The child lacks its last `>`, and consumed nothing for it.
                                p.lexer.rescan_as_jsx_element_child()?;
                                continue;
                            }
                        }

                        // The call to parseJSXElement() above doesn't consume the last
                        // TGreaterThan because the caller knows what Next() function to call.
                        // Use NextJSXElementChild() here since the next token is an element
                        // child.
                        p.lexer.next_jsx_element_child()?;
                        continue;
                    }

                    // This is the closing element
                    let after_slash = p.lexer.range().end();
                    p.lexer.next_inside_jsx_element()?;

                    if start_tag.is_none() && p.lexer.token != T::TGreaterThan && p.lexer.tolerant {
                        // `parseJsxClosingFragment`: nothing is consumed.
                        if p.lexer.is_log_disabled {
                            return Err(crate::Error::Backtrack);
                        }
                        let range = p.lexer.range();
                        p.lexer.ts_error(range, 17015);
                        p.lexer.list_contexts = saved_contexts;
                        let syntax = p.keep_jsx(None, opening_end, less_than_loc, after_slash);
                        return Ok(p.new_expr(
                            E::JSXElement {
                                tag: None,
                                children: ExprNodeList::move_from_list(children),
                                properties,
                                key_prop_index: key_prop_i,
                                flags,
                                close_tag_loc: range.loc,
                                syntax,
                            },
                            loc,
                        ));
                    }

                    let end_tag = JSXTag::parse(p)?;

                    if end_tag.name != tag.name && p.lexer.tolerant && !p.lexer.is_log_disabled {
                        let belongs_to_parent = Self::report_jsx_tag_mismatch(
                            p,
                            loc,
                            &tag,
                            &end_tag,
                            parent_tag,
                            after_slash,
                        )?;
                        let mut end = Self::end_of_jsx_tag(p);
                        let close_tag_loc = end_tag.range.loc;
                        let closing_tag = if belongs_to_parent {
                            // The closing tag of this one is missed where that of the parent starts.
                            p.jsx_adopted_close = Some((end_tag, less_than_loc, end));
                            end = less_than_loc;
                            p.new_expr(E::Missing {}, less_than_loc)
                        } else {
                            // `</>` has a missing name.
                            end_tag
                                .data
                                .as_expr()
                                .unwrap_or_else(|| p.new_expr(E::Missing {}, after_slash))
                        };
                        p.lexer.list_contexts = saved_contexts;
                        let syntax = p.keep_jsx(Some(closing_tag), opening_end, less_than_loc, end);
                        return Ok(p.new_expr(
                            E::JSXElement {
                                tag: start_tag,
                                children: ExprNodeList::move_from_list(children),
                                properties,
                                key_prop_index: key_prop_i,
                                flags,
                                close_tag_loc,
                                syntax,
                            },
                            loc,
                        ));
                    }

                    if end_tag.name != tag.name {
                        p.log().add_range_error_fmt_with_note(
                            Some(p.source),
                            end_tag.range,
                            format_args!(
                                "Expected closing JSX tag to match opening tag \"<{}>\"",
                                bstr::BStr::new(tag.name)
                            ),
                            format_args!("Opening tag here:"),
                            tag.range,
                        );
                        return Err(crate::Error::SyntaxError);
                    }

                    if p.lexer.token != T::TGreaterThan {
                        p.lexer.expected(T::TGreaterThan)?;
                    }
                    let end = Self::end_of_jsx_tag(p);

                    p.lexer.list_contexts = saved_contexts;
                    // The type checker looks at both names (`checkJsxElementDeferred`).
                    let closing_tag = end_tag.data.as_expr();
                    let kept_tag = if p.keeps_type_syntax() {
                        start_tag
                    } else {
                        closing_tag
                    };
                    let syntax = p.keep_jsx(closing_tag, opening_end, less_than_loc, end);
                    return Ok(p.new_expr(
                        E::JSXElement {
                            tag: kept_tag,
                            children: ExprNodeList::move_from_list(children),
                            properties,
                            key_prop_index: key_prop_i,
                            flags,
                            close_tag_loc: end_tag.range.loc,
                            syntax,
                        },
                        loc,
                    ));
                }
                _ => {
                    if p.lexer.token == T::TEndOfFile
                        && p.lexer.tolerant
                        && !p.lexer.is_log_disabled
                    {
                        Self::report_unclosed_jsx_element(p, loc, &tag, parent_tag.is_some());
                        let at = p.lexer.loc();
                        let closing_tag = start_tag.map(|_| p.new_expr(E::Missing {}, at));
                        let syntax = p.keep_jsx(closing_tag, opening_end, at, at);
                        p.lexer.list_contexts = saved_contexts;
                        return Ok(p.new_expr(
                            E::JSXElement {
                                tag: start_tag,
                                children: ExprNodeList::move_from_list(children),
                                properties,
                                key_prop_index: key_prop_i,
                                flags,
                                close_tag_loc: loc,
                                syntax,
                            },
                            loc,
                        ));
                    }
                    // `parseJsxChild`: a conflict marker ends the children. The lexer gives it as a syntax error that starts where the
                    // text before it does, and that is where `parseJsxClosingElement` misses the `</`. What else it misses is at
                    // the same place. The marker stays: a parent element scans it again, and a statement list skips it.
                    if p.lexer.token == T::TSyntaxError
                        && p.lexer.tolerant
                        && !p.lexer.is_log_disabled
                    {
                        let at = p.lexer.loc();
                        let marker = p.lexer.range();
                        p.lexer.ts_expected(marker, "</");
                        let closing_tag = start_tag.map(|_| p.new_expr(E::Missing {}, at));
                        let syntax = p.keep_jsx(closing_tag, opening_end, at, at);
                        p.lexer.list_contexts = saved_contexts;
                        return Ok(p.new_expr(
                            E::JSXElement {
                                tag: start_tag,
                                children: ExprNodeList::move_from_list(children),
                                properties,
                                key_prop_index: key_prop_i,
                                flags,
                                close_tag_loc: at,
                                syntax,
                            },
                            loc,
                        ));
                    }
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }
            }
        }
    }

    /// `finishNode`, of an opening or closing tag. Call before its last `>` is consumed, or where that is missed.
    #[inline]
    fn end_of_jsx_tag(p: &mut Self) -> bun_ast::Loc {
        if p.lexer.token == T::TGreaterThan {
            p.lexer.range().end()
        } else {
            Self::end_of_jsx_tag_without_greater_than(p)
        }
    }

    /// Tolerant mode only.
    #[cold]
    #[inline(never)]
    fn end_of_jsx_tag_without_greater_than(p: &mut Self) -> bun_ast::Loc {
        if p.lexer.token == T::TEndOfFile && p.jsx_children_met_end_of_file {
            p.lexer.loc()
        } else {
            p.lexer.full_start()
        }
    }

    /// `parseList(PCJsxAttributes)`, at a token that is neither a JSX name nor a `{`. Returns true if the list continues.
    #[cold]
    #[inline(never)]
    fn recover_jsx_attribute(p: &mut Self) -> crate::CrateResult<bool> {
        // `isListTerminator`. A speculative parse must still fail on errors.
        if matches!(p.lexer.token, T::TGreaterThan | T::TSlash | T::TEndOfFile)
            || p.lexer.is_log_disabled
        {
            return Ok(false);
        }
        if p.lexer.is_identifier_or_keyword() {
            // A word that the ordinary lexer scanned.
            Self::rescan_inside_jsx_element(p)?;
            return Ok(p.lexer.token == T::TIdentifier);
        }
        // `abortParsingListOrMoveToNextToken`
        let (range, before) = (p.lexer.range(), p.lexer.prev_error_loc);
        p.lexer.ts_error(range, 1003);
        if p.is_in_some_parsing_context() {
            p.lexer.put_up_with(before)?;
            return Ok(false);
        }
        p.lexer.next_inside_jsx_element()?;
        Ok(true)
    }

    /// `scanJsxIdentifier`: scans the current token again as a token inside a JSX tag.
    #[cold]
    #[inline(never)]
    fn rescan_inside_jsx_element(p: &mut Self) -> crate::CrateResult<()> {
        p.lexer.current = p.lexer.start;
        p.lexer.step();
        p.lexer.next_inside_jsx_element()?;
        Ok(())
    }

    /// `parseJsxChild` at the end of the file: 17008 or 17014 at the opening tag, then 1005 for the missing `</`.
    /// `loc` is the `<` of the element.
    #[cold]
    #[inline(never)]
    fn report_unclosed_jsx_element(
        p: &mut Self,
        loc: bun_ast::Loc,
        tag: &JSXTag<'a>,
        is_child: bool,
    ) {
        p.jsx_children_met_end_of_file = true;
        if tag.data.as_expr().is_some() {
            p.lexer.ts_error(tag.range, 17008);
        } else {
            // The fragment's node starts at the full start of its `<`. Before a child that is the `<`: whitespace is text.
            let start = if is_child {
                loc
            } else {
                p.lexer.full_start_of(loc.to_usize())
            };
            // It ends with its `>`, which is where `JSXTag::parse` says the tag is.
            let len = tag.range.loc.start + 1 - start.start;
            p.lexer.ts_error(bun_ast::Range { loc: start, len }, 17014);
        }
        let end_of_file = p.lexer.range();
        p.lexer.ts_expected(end_of_file, "</");
    }

    /// `parseJsxElementOrSelfClosingElementOrFragment`: the closing tag `end_tag`, just parsed, does not name the element `tag`.
    /// `loc` is the `<` of the element, `after_slash` is where the `</` ends. Returns true if the closing tag names the parent
    /// element, which then takes it.
    #[cold]
    #[inline(never)]
    fn report_jsx_tag_mismatch(
        p: &mut Self,
        loc: bun_ast::Loc,
        tag: &JSXTag<'a>,
        end_tag: &JSXTag<'a>,
        parent_tag: Option<&'a [u8]>,
        after_slash: bun_ast::Loc,
    ) -> crate::CrateResult<bool> {
        if end_tag.data.as_expr().is_none() {
            // `parseJsxTagName`: `</>` has no name.
            let range = p.lexer.range();
            p.lexer.ts_error(range, 1003);
        }
        // `parseJsxClosingElement`
        if p.lexer.token != T::TGreaterThan {
            p.lexer.expected(T::TGreaterThan)?;
        }
        // The node of a tag name starts where the `<` or `</` before it ends.
        if parent_tag.is_some_and(|parent| !parent.is_empty() && parent == end_tag.name) {
            let start = bun_ast::Loc {
                start: loc.start + 1,
            };
            let len = (tag.range.end().start - start.start).max(0);
            p.lexer.ts_error(bun_ast::Range { loc: start, len }, 17008);
            return Ok(true);
        }
        let len = (end_tag.range.end().start - after_slash.start).max(0);
        let opening = p.source.contents();
        let opening = opening
            .get(tag.range.loc.to_usize()..tag.range.end().to_usize())
            .unwrap_or_default();
        p.lexer.ts_error_about(
            bun_ast::Range {
                loc: after_slash,
                len,
            },
            17002,
            opening,
        );
        Ok(false)
    }
}
