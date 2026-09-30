//! Syntax around an expression that the parse pass reads and builds no node of, kept for a lint parse.

use bun_ast::ts;
use bun_ast::{Expr, ExprData, ExprTag, Loc};

use crate::lexer::Lexer;

/// Syntax around an expression that leaves no node: the tree holds `operand` where the source has the wrapper.
#[derive(Clone, Copy)]
pub struct Wrapper {
    /// What the wrapper is around, as the tree holds it.
    pub operand: Expr,
    /// Offset of `as`, of `satisfies`, of `!`, of `<` or of `(`.
    pub op: u32,
    /// Offset after the type of `as` and `satisfies`, after `!`, after `>` or after `)`.
    pub end: u32,
    pub data: WrapperData,
}

#[derive(Clone, Copy)]
pub enum WrapperData {
    /// `operand as T`: `as const` has a `TypeReference` to the name `const`.
    As(ts::Type),
    /// `operand satisfies T`.
    Satisfies(ts::Type),
    /// `operand!`.
    NonNull,
    /// `<T>operand`: the operand is the whole unary expression after `>`.
    TypeAssertion(ts::Type),
    /// `(operand)`.
    Parenthesized,
}

/// The identity of an expression node: where it starts, its kind, and the address of its payload when it has one.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ExprId {
    pub loc: i32,
    pub tag: ExprTag,
    pub payload: usize,
}

/// The wrappers that a lint parse reads.
#[derive(Default)]
pub struct Wrappers {
    /// In the order the parse pass finishes them: of the wrappers around one operand, an inner one comes first.
    pub records: Vec<Wrapper>,
}

const _: () = assert!(core::mem::size_of::<Wrapper>() == 48);

impl Wrapper {
    /// Whether `expr` is the node that the wrapper is around.
    pub fn wraps(&self, expr: &Expr) -> bool {
        ExprId::of(&self.operand) == ExprId::of(expr)
    }

    /// The type of `as`, of `satisfies` and of `<T>`.
    pub fn type_node(&self) -> Option<ts::Type> {
        match self.data {
            WrapperData::As(type_node)
            | WrapperData::Satisfies(type_node)
            | WrapperData::TypeAssertion(type_node) => Some(type_node),
            WrapperData::NonNull | WrapperData::Parenthesized => None,
        }
    }
}

impl WrapperData {
    /// The name that `ts.SyntaxKind` has for the kind.
    pub const fn kind_name(&self) -> &'static str {
        match self {
            WrapperData::As(_) => "AsExpression",
            WrapperData::Satisfies(_) => "SatisfiesExpression",
            WrapperData::NonNull => "NonNullExpression",
            WrapperData::TypeAssertion(_) => "TypeAssertionExpression",
            WrapperData::Parenthesized => "ParenthesizedExpression",
        }
    }
}

impl ExprId {
    pub fn of(expr: &Expr) -> ExprId {
        let payload = match expr.data {
            ExprData::EArray(node) => node.as_ptr() as usize,
            ExprData::EUnary(node) => node.as_ptr() as usize,
            ExprData::EBinary(node) => node.as_ptr() as usize,
            ExprData::EClass(node) => node.as_ptr() as usize,
            ExprData::ENew(node) => node.as_ptr() as usize,
            ExprData::EFunction(node) => node.as_ptr() as usize,
            ExprData::ECall(node) => node.as_ptr() as usize,
            ExprData::EDot(node) => node.as_ptr() as usize,
            ExprData::EIndex(node) => node.as_ptr() as usize,
            ExprData::EArrow(node) => node.as_ptr() as usize,
            ExprData::EJsxElement(node) => node.as_ptr() as usize,
            ExprData::EObject(node) => node.as_ptr() as usize,
            ExprData::EObjectJSON(node) => node.as_ptr() as usize,
            ExprData::EArrayJSON(node) => node.as_ptr() as usize,
            ExprData::ESpread(node) => node.as_ptr() as usize,
            ExprData::ETemplate(node) => node.as_ptr() as usize,
            ExprData::ERegExp(node) => node.as_ptr() as usize,
            ExprData::EAwait(node) => node.as_ptr() as usize,
            ExprData::EYield(node) => node.as_ptr() as usize,
            ExprData::EIf(node) => node.as_ptr() as usize,
            ExprData::EImport(node) => node.as_ptr() as usize,
            ExprData::EBigInt(node) => node.as_ptr() as usize,
            ExprData::EString(node) => node.as_ptr() as usize,
            ExprData::EInlinedEnum(node) => node.as_ptr() as usize,
            ExprData::ENameOfSymbol(node) => node.as_ptr() as usize,
            _ => 0,
        };
        ExprId {
            loc: expr.loc.start,
            tag: expr.data.tag(),
            payload,
        }
    }
}

impl Wrappers {
    /// Drops the records of what the parser read from `position` on: it goes back there.
    #[cold]
    pub(crate) fn rewind_to(&mut self, position: usize) {
        while self
            .records
            .last()
            .is_some_and(|record| record.op as usize >= position)
        {
            self.records.pop();
        }
    }

    /// Records `operand!`: `exclamation` is where the `!` is.
    #[cold]
    #[inline(never)]
    pub(crate) fn non_null(&mut self, operand: Expr, exclamation: Loc) {
        let op = offset(exclamation);
        self.records.push(Wrapper {
            operand,
            op,
            end: op + 1,
            data: WrapperData::NonNull,
        });
    }

    /// Records `(operand)`: `open` and `close` are where the `(` and the `)` are.
    #[cold]
    #[inline(never)]
    pub(crate) fn parenthesized(&mut self, operand: Expr, open: Loc, close: Loc) {
        self.records.push(Wrapper {
            operand,
            op: offset(open),
            end: offset(close) + 1,
            data: WrapperData::Parenthesized,
        });
    }

    /// Records `(operand)` once the lexer has read past the `)`: `open` is where the `(` is.
    #[cold]
    #[inline(never)]
    pub(crate) fn parenthesized_before(&mut self, operand: Expr, open: Loc, lexer: &Lexer<'_>) {
        self.records.push(Wrapper {
            operand,
            op: offset(open),
            end: token_end(lexer),
            data: WrapperData::Parenthesized,
        });
    }

    /// Records `operand as T` or `operand satisfies T`: `keyword` is where the word is.
    #[cold]
    #[inline(never)]
    pub(crate) fn as_or_satisfies(
        &mut self,
        operand: Expr,
        keyword: Loc,
        is_satisfies: bool,
        type_node: ts::Type,
    ) {
        let data = if is_satisfies {
            WrapperData::Satisfies(type_node)
        } else {
            WrapperData::As(type_node)
        };
        self.records.push(Wrapper {
            operand,
            op: offset(keyword),
            end: type_node.end,
            data,
        });
    }

    /// Records `<T>operand`: `less_than` and `greater_than` are where the `<` and the `>` are.
    #[cold]
    #[inline(never)]
    pub(crate) fn type_assertion(
        &mut self,
        operand: Expr,
        less_than: Loc,
        greater_than: Loc,
        type_node: ts::Type,
    ) {
        self.records.push(Wrapper {
            operand,
            op: offset(less_than),
            end: offset(greater_than) + 1,
            data: WrapperData::TypeAssertion(type_node),
        });
    }
}

/// The offset after the last token that the lexer read past: the white space and the comments before its token are no part of it.
fn token_end(lexer: &Lexer<'_>) -> u32 {
    let next = u32::try_from(lexer.start).unwrap_or(u32::MAX);
    ts::full_start(lexer.contents, &lexer.all_comments, next)
}

fn offset(loc: Loc) -> u32 {
    u32::try_from(loc.start).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defines::Define;
    use crate::parse::parse_entry::{Options, ParsedForLint, Parser};
    use bun_alloc::Arena;
    use bun_ast::{E, Loader, OpCode, StoreRef};

    fn identifier(start: i32) -> Expr {
        Expr {
            loc: Loc { start },
            data: ExprData::EIdentifier(E::Identifier::default()),
        }
    }

    fn comma() -> E::Binary {
        E::Binary {
            op: OpCode::BinComma,
            left: Expr::EMPTY,
            right: Expr::EMPTY,
        }
    }

    fn any(start: u32, end: u32) -> ts::Type {
        ts::Type::keyword(ts::KeywordKind::Any, start, end)
    }

    #[test]
    fn identity_tells_the_nodes_at_one_offset_apart() {
        let (mut first, mut second) = (comma(), comma());
        let loc = Loc { start: 4 };
        let inner = Expr {
            loc,
            data: ExprData::EBinary(StoreRef::from_bump(&mut first)),
        };
        let outer = Expr {
            loc,
            data: ExprData::EBinary(StoreRef::from_bump(&mut second)),
        };
        let mut wrappers = Wrappers::default();
        wrappers.non_null(inner, Loc { start: 9 });
        let [record] = wrappers.records.as_slice() else {
            panic!("one record");
        };
        assert!(record.wraps(&inner));
        assert!(!record.wraps(&outer));
        assert!(!record.wraps(&identifier(4)));
        assert_eq!(ExprId::of(&identifier(4)), ExprId::of(&identifier(4)));
        assert_ne!(ExprId::of(&identifier(4)), ExprId::of(&identifier(5)));
    }

    #[test]
    fn records_hold_the_offsets_of_their_own_tokens() {
        let source = b"<any>(x as any)! satisfies any";
        let x = identifier(6);
        let mut wrappers = Wrappers::default();
        wrappers.as_or_satisfies(x, Loc { start: 8 }, false, any(11, 14));
        wrappers.parenthesized(x, Loc { start: 5 }, Loc { start: 14 });
        wrappers.non_null(x, Loc { start: 15 });
        wrappers.type_assertion(x, Loc { start: 0 }, Loc { start: 4 }, any(1, 4));
        wrappers.as_or_satisfies(x, Loc { start: 17 }, true, any(27, 30));
        let found: Vec<(&str, &[u8], Option<(u32, u32)>)> = wrappers
            .records
            .iter()
            .map(|record| {
                let text = source
                    .get(record.op as usize..record.end as usize)
                    .unwrap_or(&[]);
                let type_node = record.type_node().map(|node| (node.start, node.end));
                (record.data.kind_name(), text, type_node)
            })
            .collect();
        let expected: [(&str, &[u8], Option<(u32, u32)>); 5] = [
            ("AsExpression", b"as any", Some((11, 14))),
            ("ParenthesizedExpression", b"(x as any)", None),
            ("NonNullExpression", b"!", None),
            ("TypeAssertionExpression", b"<any>", Some((1, 4))),
            ("SatisfiesExpression", b"satisfies any", Some((27, 30))),
        ];
        assert_eq!(found, expected);
        assert!(wrappers.records.iter().all(|record| record.wraps(&x)));
    }

    #[test]
    fn rewind_drops_what_was_read_from_the_position_on() {
        let mut wrappers = Wrappers::default();
        wrappers.non_null(identifier(0), Loc { start: 1 });
        wrappers.parenthesized(identifier(4), Loc { start: 3 }, Loc { start: 5 });
        wrappers.non_null(identifier(4), Loc { start: 6 });
        wrappers.rewind_to(7);
        assert_eq!(wrappers.records.len(), 3);
        wrappers.rewind_to(3);
        let [record] = wrappers.records.as_slice() else {
            panic!("one record");
        };
        assert_eq!((record.op, record.end), (1, 2));
        wrappers.rewind_to(0);
        assert!(wrappers.records.is_empty());
    }

    struct Case {
        name: &'static str,
        path: &'static [u8],
        loader: Loader,
        text: &'static [u8],
        /// One line for each record, in the order of the records.
        records: &'static [&'static str],
    }

    /// A line for each record that the lint parse of `case` makes. `None`: it does not parse.
    fn lint_parse(case: &Case) -> Option<Vec<String>> {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(case.path, case.text);
        let mut options = Options::init(Default::default(), case.loader);
        options.features.no_macros = true;
        options.features.dont_bundle_twice = true;
        let define = Define::default();
        let mut log = bun_ast::Log::init();
        let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
        parser.parse_for_lint(describe).ok()
    }

    fn describe(parsed: &ParsedForLint<'_, '_>) -> Vec<String> {
        let records = &parsed.sidecar.wrappers.records;
        records
            .iter()
            .map(|record| {
                let kind = record.data.kind_name();
                let (op, end) = (record.op, record.end);
                let type_node = record.type_node().map(described).unwrap_or_default();
                let tag = <&'static str>::from(record.operand.data.tag());
                let start = record.operand.loc.start;
                format!("{kind} [{op},{end}){type_node} of {tag}@{start}")
            })
            .collect()
    }

    fn described(type_node: ts::Type) -> String {
        let kind = type_node.data.kind_name();
        let name = match type_node.data {
            ts::TypeData::TypeReference(reference) => match reference.type_name {
                ts::EntityName::Identifier(name) => {
                    format!("({})", bstr::BStr::new(name.text.slice()))
                }
                ts::EntityName::QualifiedName(_) => String::new(),
            },
            _ => String::new(),
        };
        format!(" {kind}{name}[{},{})", type_node.start, type_node.end)
    }

    #[test]
    fn records_are_those_of_the_known_sources() {
        let mut failed = Vec::new();
        for case in CASES {
            let records = case.records.iter().map(|line| (*line).to_owned()).collect();
            let expected: Option<Vec<String>> = Some(records);
            let found = lint_parse(case);
            if found != expected {
                failed.push(format!("{}: {found:#?}", case.name));
            }
        }
        assert!(failed.is_empty(), "{}", failed.join("\n"));
    }

    #[test]
    fn a_type_assertion_needs_a_type() {
        let case = Case {
            name: "type-assertion-without-a-type",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"<keyof>(x);\n",
            records: &[],
        };
        assert_eq!(lint_parse(&case), None);
    }

    const CASES: &[Case] = &[
        Case {
            name: "as",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"x as T;\nconst c = [1] as const;\na.b satisfies T;\n",
            records: &[
                "AsExpression [2,6) TypeReference(T)[5,6) of e_identifier@0",
                "AsExpression [22,30) TypeReference(const)[25,30) of e_array@18",
                "SatisfiesExpression [36,47) TypeReference(T)[46,47) of e_dot@32",
            ],
        },
        Case {
            name: "non-null",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"x!;\nx!.y;\nf()!;\n",
            records: &[
                "NonNullExpression [1,2) of e_identifier@0",
                "NonNullExpression [5,6) of e_identifier@4",
                "NonNullExpression [13,14) of e_call@10",
            ],
        },
        Case {
            name: "postfix-chain",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"a.b! as C satisfies D;\n",
            records: &[
                "NonNullExpression [3,4) of e_dot@0",
                "AsExpression [5,9) TypeReference(C)[8,9) of e_dot@0",
                "SatisfiesExpression [10,21) TypeReference(D)[20,21) of e_dot@0",
            ],
        },
        Case {
            name: "type-assertion",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"<T>x;\n<T>x.y;\n<T>x++;\n<const>[1];\n<T><U>x;\n-<T>x;\n<T>a.b as C;\n",
            records: &[
                "TypeAssertionExpression [0,3) TypeReference(T)[1,2) of e_identifier@3",
                "TypeAssertionExpression [6,9) TypeReference(T)[7,8) of e_dot@9",
                "TypeAssertionExpression [14,17) TypeReference(T)[15,16) of e_unary@17",
                "TypeAssertionExpression [22,29) TypeReference(const)[23,28) of e_array@29",
                "TypeAssertionExpression [37,40) TypeReference(U)[38,39) of e_identifier@40",
                "TypeAssertionExpression [34,37) TypeReference(T)[35,36) of e_identifier@40",
                "TypeAssertionExpression [44,47) TypeReference(T)[45,46) of e_identifier@47",
                "TypeAssertionExpression [50,53) TypeReference(T)[51,52) of e_dot@53",
                "AsExpression [57,61) TypeReference(C)[60,61) of e_dot@53",
            ],
        },
        Case {
            name: "type-assertion-of-parentheses",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"<T>(x);\n<A.B>(x).y;\n<T>(x) => x;\n<T>(x)!;\n",
            records: &[
                "ParenthesizedExpression [3,6) of e_identifier@4",
                "TypeAssertionExpression [0,3) TypeReference(T)[1,2) of e_identifier@4",
                "ParenthesizedExpression [13,16) of e_identifier@14",
                "TypeAssertionExpression [8,13) TypeReference[9,12) of e_dot@14",
                "ParenthesizedExpression [36,39) of e_identifier@37",
                "NonNullExpression [39,40) of e_identifier@37",
                "TypeAssertionExpression [33,36) TypeReference(T)[34,35) of e_identifier@37",
            ],
        },
        Case {
            name: "type-parameter-with-the-name-of-a-type-operator",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"<keyof>(x) => x;\n<readonly>(x) => (x);\n<infer>(x) => x!;\n",
            records: &[
                "ParenthesizedExpression [34,37) of e_identifier@35",
                "NonNullExpression [54,55) of e_identifier@53",
            ],
        },
        Case {
            name: "parentheses",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"(a);\n((a));\n(a, b);\na * (b + c);\nf((a));\n(a) => (b);\nx = (y);\n(function () {})();\nnew (Foo)();\nif ((a)) {}\n",
            records: &[
                "ParenthesizedExpression [0,3) of e_identifier@1",
                "ParenthesizedExpression [6,9) of e_identifier@7",
                "ParenthesizedExpression [5,10) of e_identifier@7",
                "ParenthesizedExpression [12,18) of e_binary@13",
                "ParenthesizedExpression [24,31) of e_binary@25",
                "ParenthesizedExpression [35,38) of e_identifier@36",
                "ParenthesizedExpression [48,51) of e_identifier@49",
                "ParenthesizedExpression [57,60) of e_identifier@58",
                "ParenthesizedExpression [62,78) of e_function@63",
                "ParenthesizedExpression [86,91) of e_identifier@87",
                "ParenthesizedExpression [99,102) of e_identifier@100",
            ],
        },
        Case {
            name: "parentheses-and-wrappers",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"(x as T)!;\n(x!) as T;\n(<T>x);\n",
            records: &[
                "AsExpression [3,7) TypeReference(T)[6,7) of e_identifier@1",
                "ParenthesizedExpression [0,8) of e_identifier@1",
                "NonNullExpression [8,9) of e_identifier@1",
                "NonNullExpression [13,14) of e_identifier@12",
                "ParenthesizedExpression [11,15) of e_identifier@12",
                "AsExpression [16,20) TypeReference(T)[19,20) of e_identifier@12",
                "TypeAssertionExpression [23,26) TypeReference(T)[24,25) of e_identifier@26",
                "ParenthesizedExpression [22,28) of e_identifier@26",
            ],
        },
        Case {
            name: "conditional",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"a ? (b) : c;\n",
            records: &["ParenthesizedExpression [4,7) of e_identifier@5"],
        },
        Case {
            name: "conditional-arrow-read-twice",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"a ? (b) : c => (d) : e;\n",
            records: &["ParenthesizedExpression [15,18) of e_identifier@16"],
        },
        Case {
            name: "decorator",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"@(d) class C {}\n",
            records: &["ParenthesizedExpression [1,4) of e_identifier@2"],
        },
        Case {
            name: "javascript",
            path: b"/a.js",
            loader: Loader::Js,
            text: b"(a) + b;\nasync (x);\nx = (y => y);\n",
            records: &[
                "ParenthesizedExpression [0,3) of e_identifier@1",
                "ParenthesizedExpression [24,32) of e_arrow@25",
            ],
        },
        Case {
            name: "tsx",
            path: b"/a.tsx",
            loader: Loader::Tsx,
            text: b"const e = <div>{(a) as T}</div>;\n",
            records: &[
                "ParenthesizedExpression [16,19) of e_identifier@17",
                "AsExpression [20,24) TypeReference(T)[23,24) of e_identifier@17",
            ],
        },
    ];
}
