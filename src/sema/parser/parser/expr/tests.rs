use crate::{Options, Rejection, Scratch};
use bun_sema::hir::*;
use bun_sema::resolve::Dialect;
use bun_sema_standalone as _;

/// The options of the three parsers: the one without recovery, the same with the nodes around each comment, and the
/// one that recovers.
fn parsers() -> [Options; 3] {
    let with_comments = Options {
        attach_comments: true,
        ..Options::default()
    };
    let recovering = Options {
        recovers: true,
        ..with_comments
    };
    [Options::default(), with_comments, recovering]
}

fn javascript() -> Options {
    Options {
        is_javascript: true,
        is_jsx: true,
        ..Options::default()
    }
}

/// Parses `v = value;`.
fn parse(value: &str, options: Options) -> Result<(Box<FileBuilder>, String), Rejection> {
    let text = format!("v = {value};");
    let mut scratch = Scratch::default();
    match crate::parse_with_own_atoms(text.as_bytes(), options, &mut scratch) {
        Ok(parsed) => Ok((parsed.file, text)),
        Err(rejected) => Err(rejected.why),
    }
}

/// The casts and operators of the `value` with their operands, and the text of every other node and of a type.
fn reading_of(value: &str, options: Options) -> Result<String, Rejection> {
    let (file, text) = parse(value, options)?;
    let ty = |ty: TypeNodeId| match file.types.get(ty.idx()) {
        Some(ty) => &text[ty.pos as usize..ty.end as usize],
        None => "<none>",
    };
    // An operand has a lower index than the node that it is an operand of.
    let mut readings: Vec<String> = Vec::with_capacity(file.exprs.len());
    let mut assigned = None;
    for expr in &file.exprs {
        let of = |e: ExprId| readings.get(e.idx()).map_or("<none>", String::as_str);
        let reading = match expr.kind {
            ExprKind::AsConst(inner) => format!("const({})", of(inner)),
            ExprKind::As { expr, ty: to } => format!("as({}, {})", of(expr), ty(to)),
            ExprKind::Satisfies { expr, ty: to } => format!("satisfies({}, {})", of(expr), ty(to)),
            ExprKind::Binary { left, right, .. } => format!("binary({}, {})", of(left), of(right)),
            ExprKind::Cond { test, .. } => format!("cond({})", of(test)),
            ExprKind::Assign { value, .. } => {
                assigned = Some(of(value).to_owned());
                String::new()
            }
            _ => (text.get(expr.pos as usize..expr.end as usize))
                .unwrap_or("<none>")
                .to_owned(),
        };
        readings.push(reading);
    }
    Ok(assigned.unwrap())
}

/// The `(code, start, end)` of each diagnostic, where `start` and `end` count from the start of `value`.
fn diagnostics_of(value: &str, options: Options) -> Vec<(u32, u32, u32)> {
    let (file, _) = parse(value, options).unwrap();
    let relative = |it: &Diagnostic| (it.code, it.start - 4, it.end - 4);
    file.diagnostics.iter().map(relative).collect()
}

#[track_caller]
fn expect_reading(options: Options, cases: &[(&str, &str)]) {
    for &(value, expected) in cases {
        let found = reading_of(value, options);
        assert_eq!(found.as_deref(), Ok(expected), "{value}");
    }
}

// Each text is read as TypeScript 6.0.2 reads it.
#[test]
fn type_that_continues_after_const() {
    for options in parsers() {
        expect_reading(
            options,
            &[
                ("x as const | 'X'", "as(x, const | 'X')"),
                ("x as const & 'X'", "as(x, const & 'X')"),
                ("x as const | y | z", "as(x, const | y | z)"),
                ("x as const\n| y", "as(x, const\n| y)"),
                ("x as const\n& y", "as(x, const\n& y)"),
                ("x as const[]", "as(x, const[])"),
                ("x as const[0]", "as(x, const[0])"),
                ("x as const.b", "as(x, const.b)"),
                ("x as const\n.b", "as(x, const\n.b)"),
                ("x as const<T>", "as(x, const<T>)"),
                ("x as const!", "as(x, const!)"),
                ("(x as const?)", "as(x, const?)"),
                (
                    "x as const extends T ? 1 : 2",
                    "as(x, const extends T ? 1 : 2)",
                ),
                (
                    "x as const | y satisfies T",
                    "satisfies(as(x, const | y), T)",
                ),
                ("x as const | y || z", "binary(as(x, const | y), z)"),
                ("<const | T>e", "as(e, const | T)"),
                ("<const & T>e", "as(e, const & T)"),
                ("<const<<T>() => void>>x", "as(x, const<<T>() => void>)"),
            ],
        );
    }
}

#[test]
fn const_that_is_the_whole_type() {
    let cases = [
        ("x as const", "const(x)"),
        ("[x as const, y]", "[x as const, y]"),
        ("`${x as const}`", "`${x as const}`"),
        ("a ? x as const : y", "cond(a)"),
        ("x as const || y", "binary(const(x), y)"),
        ("x as const ?? y", "binary(const(x), y)"),
        ("x as const + 1", "binary(const(x), 1)"),
        ("x as const != y", "binary(const(x), y)"),
        ("x as const > y", "binary(const(x), y)"),
        ("x as const >= y", "binary(const(x), y)"),
        ("x as const >> y", "binary(const(x), y)"),
        ("x as const in y", "binary(const(x), y)"),
        ("x as const instanceof y", "binary(const(x), y)"),
        ("x as const ? 1 : 2", "cond(const(x))"),
        ("x as const ? -1 : 1", "cond(const(x))"),
        ("x as const\n? 1 : 2", "cond(const(x))"),
        ("x as const\n[0]", "const(x)"),
        ("x as const\n!y", "const(x)"),
        ("x as const\nextend(y)", "const(x)"),
        ("x as\nconst || y", "binary(const(x), y)"),
        ("<const>e", "const(e)"),
        ("<const>e || y", "binary(const(e), y)"),
    ];
    for options in parsers() {
        expect_reading(options, &cases);
        expect_reading(
            options,
            &[
                ("x as const as string", "as(const(x), string)"),
                ("x as const satisfies T", "satisfies(const(x), T)"),
            ],
        );
        // Where the type is parsed to find its end, nothing of it stays.
        for (value, _) in cases {
            let (file, _) = parse(value, options).unwrap();
            let left = (
                file.types.len(),
                file.names.len(),
                file.keyword_identifier_positions.len(),
                file.diagnostics.len(),
            );
            assert_eq!(left, (0, 0, 0, 0), "{value}");
        }
    }
}

#[test]
fn comment_beside_const_that_is_the_whole_type() {
    let nodes_around = |value: &str, options: Options| {
        let (file, _) = parse(value, options).unwrap();
        let around = |it: &Comment| (it.enclosing_node, it.preceding_node, it.following_node);
        file.comments.iter().map(around).collect::<Vec<_>>()
    };
    let expr = |id: u32| NodeOrName::Node(NodeData::Expr(ExprId(id)));
    // `x` is expression 1, the const assertion 2, `y` 3 and the operator 4.
    let (x, assertion, y, operator) = (expr(1), expr(2), expr(3), expr(4));
    let expected = [(assertion, x, NodeOrName::None), (operator, assertion, y)];
    for options in parsers().into_iter().filter(|it| it.attach_comments) {
        for value in [
            "x as /* a */ const /* b */ || y",
            "x as // a\nconst // b\n|| y",
        ] {
            assert_eq!(nodes_around(value, options), expected, "{value}");
        }
    }
}

#[test]
fn type_after_const_that_typescript_reports() {
    let [without_recovery, with_comments, recovering] = parsers();
    let cases = [
        ("x as const ? +a : b", "binary(as(x, const ?), a)"),
        ("x as const << 2", "as(x, const << 2)"),
        ("x as const < y", "as(x, const < y)"),
    ];
    for (value, expected) in cases {
        for options in [without_recovery, with_comments] {
            let found = reading_of(value, options);
            assert_eq!(found, Err(Rejection::Syntax), "{value}");
        }
        expect_reading(recovering, &[(value, expected)]);
        let reported = diagnostics_of(value, recovering);
        assert!(reported.iter().any(|it| it.0 == 1005), "{value}");
    }
}

// TypeScript 7.0.2 reports nothing about the list.
#[test]
fn empty_type_arguments_after_const() {
    let [without_recovery, with_comments, recovering] = parsers();
    for options in [without_recovery, with_comments] {
        let found = reading_of("x as const<>", options);
        assert_eq!(found, Err(Rejection::Reported));
    }
    let cases = [
        ("x as const<>", "const(x)"),
        ("x as const<> || y", "binary(const(x), y)"),
        ("<const < >>x", "const(x)"),
    ];
    expect_reading(recovering, &cases);
    for (value, _) in cases {
        assert_eq!(diagnostics_of(value, recovering), [], "{value}");
    }
}

#[test]
fn escaped_const_stays_an_error() {
    let [without_recovery, _, recovering] = parsers();
    let found = reading_of("x as \\u0063onst | y", without_recovery);
    assert_eq!(found, Err(Rejection::EscapedKeyword));
    let cases = [
        ("x as \\u0063onst", "const(x)"),
        ("x as \\u0063onst || y", "binary(const(x), y)"),
        ("x as \\u0063onst | y", "binary(const(x), y)"),
    ];
    expect_reading(recovering, &cases);
    for (value, _) in cases {
        let reported = diagnostics_of(value, recovering);
        assert_eq!(reported, [(1260, 5, 15)], "{value}");
    }
}

#[test]
fn type_after_const_that_bun_run_ends() {
    let compiles = Options {
        compiles: true,
        ..Options::default()
    };
    expect_reading(
        compiles,
        &[
            ("x as const ? +a : b", "cond(const(x))"),
            ("x as const << 2", "binary(const(x), 2)"),
            ("x as const | y", "as(x, const | y)"),
            ("x as const\n| y", "as(x, const\n| y)"),
        ],
    );
}

// Each text is read as @babel/parser 7 and @sveltejs/acorn-typescript read it, or is an error as it is to them.
#[test]
fn const_as_babel_reads_it() {
    let babel_ts = |options: Options| Options {
        dialect: Dialect {
            babel_ts: true,
            ..Dialect::babel(false)
        },
        ..options
    };
    for options in parsers().map(babel_ts) {
        expect_reading(
            options,
            &[
                ("x as const", "const(x)"),
                ("x as const | y", "binary(const(x), y)"),
                ("x as const & y", "binary(const(x), y)"),
                ("x as const\n| y", "binary(const(x), y)"),
                ("x as const | y + 1", "binary(const(x), binary(y, 1))"),
                ("x as const ? +a : b", "cond(const(x))"),
                ("x as const << 2", "binary(const(x), 2)"),
                ("x as const.b", "as(x, const.b)"),
                ("x as const.b | y", "binary(as(x, const.b), y)"),
                ("x as const<T>", "as(x, const<T>)"),
                ("x as any | y", "as(x, any | y)"),
                ("<const>e", "const(e)"),
            ],
        );
        // Without recovery a text that has an error is refused.
        let rejected = [
            "x as const[]",
            "x as const!",
            "x as const extends T ? 1 : 2",
            "<const | T>e",
        ];
        for value in rejected {
            match options.recovers {
                true => assert_ne!(diagnostics_of(value, options), [], "{value}"),
                false => assert_eq!(
                    reading_of(value, options),
                    Err(Rejection::Syntax),
                    "{value}"
                ),
            }
        }
    }
}

#[test]
fn const_in_flow() {
    let flow = Options {
        dialect: Dialect {
            ecmascript: true,
            flow: true,
            ..Dialect::default()
        },
        ..javascript()
    };
    expect_reading(
        flow,
        &[
            ("x as const", "const(x)"),
            ("x as const | y", "binary(const(x), y)"),
            ("x as const\n[0]", "const(x)"),
        ],
    );
    for value in ["x as const.b", "x as const<T>", "x as const[0]"] {
        let found = reading_of(value, flow);
        assert_eq!(found, Err(Rejection::Reported), "{value}");
    }
}

#[test]
fn javascript_file_reports_the_type() {
    let recovering = Options {
        recovers: true,
        ..javascript()
    };
    for options in [javascript(), recovering] {
        let cases = [
            ("x as const", "const(x)", (5, 10)),
            ("x as const || y", "binary(const(x), y)", (5, 10)),
            ("x as\nconst\n|| y", "binary(const(x), y)", (5, 10)),
            ("x as const | y", "as(x, const | y)", (5, 14)),
            ("x as const[]", "as(x, const[])", (5, 12)),
        ];
        for (value, expected, (start, end)) in cases {
            expect_reading(options, &[(value, expected)]);
            let reported = diagnostics_of(value, options);
            assert_eq!(reported, [(8016, start, end)], "{value}");
        }
    }
}
