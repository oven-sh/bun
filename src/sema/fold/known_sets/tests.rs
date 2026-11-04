use super::MOST_VALUES_IN_A_KNOWN_SET;
use crate::atom::{Atom, Interner};
use crate::bind::{BindOptions, RuntimeBindOptions, bind};
use crate::file_analysis::FileInputs;
use crate::fold::{Constant, FoldInputs, FoldOptions, KnownSets, fold_file};
use crate::hir::{
    BinOp, Branches, Call, Chain, ExprId, ExprKind, FileBuilder, Flags, FnBody, FnKind, Func,
    ListAt, ParamId, PatKind, Span, StmtId, StmtKind, TextRange, TypeNodeId, UnOp, VarDecl,
    VarKind,
};
use crate::import_sites::JsxMode;
use crate::module_format::DeclaredModuleType;
use crate::session::Session;
use std::cell::RefCell;

const MAX_STRING_BYTES: usize = 1 << 16;

const FILE_INPUTS: FileInputs<'static> = FileInputs {
    declared_module_type: DeclaredModuleType::Unknown,
    import_meta_main: None,
    is_library: false,
    host_values: &[],
    jsx: JsxMode::Classic,
    own_name: b"",
};

/// This crate has no parser, so each test builds its tree by hand. The parser numbers expressions in source order, operands before the expression
/// that contains them, and known sets compare those numbers. So call each method in the order its node appears in the source.
struct Tree<'s> {
    atoms: Interner<'s>,
    file: RefCell<FileBuilder>,
    marked: RefCell<Vec<ExprId>>,
}

impl Tree<'_> {
    fn atom(&self, text: &str) -> Atom {
        self.atoms.intern(text.as_bytes())
    }

    fn expr(&self, kind: ExprKind) -> ExprId {
        self.file.borrow_mut().expr(kind, 0, 0)
    }

    fn stmt(&self, kind: StmtKind) -> StmtId {
        self.file.borrow_mut().stmt(kind, 0)
    }

    fn name(&self, name: &str) -> ExprId {
        self.expr(ExprKind::Ident(self.atom(name)))
    }

    fn text(&self, text: &str) -> ExprId {
        self.expr(ExprKind::String(self.atom(text)))
    }

    fn number(&self, value: f64) -> ExprId {
        let index = self.file.borrow_mut().number(value);
        self.expr(ExprKind::Number(index))
    }

    fn binary(&self, op: BinOp, left: ExprId, right: ExprId) -> ExprId {
        self.expr(ExprKind::Binary { op, left, right })
    }

    fn cond(&self, test: ExprId, yes: ExprId, no: ExprId) -> ExprId {
        let branches = self.file.borrow_mut().store_branches(Branches { yes, no });
        self.expr(ExprKind::Cond { test, branches })
    }

    /// `c ? "yes" : "no"`
    fn either(&self, yes: &str, no: &str) -> ExprId {
        self.cond(self.name("c"), self.text(yes), self.text(no))
    }

    fn array(&self, items: &[ExprId]) -> ExprId {
        let items = self.file.borrow_mut().list(items);
        self.expr(ExprKind::Array(items))
    }

    /// `["a", "b"]`
    fn letters(&self) -> ExprId {
        self.array(&[self.text("a"), self.text("b")])
    }

    fn template(&self, before: &str, substitution: ExprId, after: &str) -> ExprId {
        let texts = [self.atom(before), self.atom(after)];
        let mut file = self.file.borrow_mut();
        let exprs = file.list(&[substitution]);
        file.list(&texts);
        file.expr(ExprKind::Template { exprs }, 0, 0)
    }

    /// `list.push(d);`
    fn push_to(&self, list: &str) -> StmtId {
        let object = self.name(list);
        let member = (self.file.borrow_mut()).dot((object, Chain::No), (self.atom("push"), 0), 0);
        let callee = self.expr(member);
        let argument = self.name("d");
        let mut file = self.file.borrow_mut();
        let call = Call {
            callee,
            args: file.list(&[argument]),
            type_args: ListAt::EMPTY,
            close_pos: 0,
            chain: Chain::No,
            is_pure: false,
        };
        let call = file.add_call(call);
        let call = file.expr(ExprKind::Call(call), 0, 0);
        file.stmt(StmtKind::Expr(call), 0)
    }

    /// `e;`. `sets_of` returns the values of `e`.
    fn mark(&self, e: ExprId) -> StmtId {
        self.marked.borrow_mut().push(e);
        self.stmt(StmtKind::Expr(e))
    }

    fn declare(&self, kind: VarKind, name: &str, init: ExprId) -> StmtId {
        let mut file = self.file.borrow_mut();
        let pat = file.pat(PatKind::Ident(self.atom(name)), 0, 0);
        let declarations = file.add_var_decls(&[VarDecl {
            pat,
            ty: TypeNodeId::NONE,
            init,
            kind,
            flags: Flags::empty(),
            loc: TextRange::default(),
        }]);
        file.stmt(StmtKind::Var(declarations), 0)
    }

    /// `for (const n of walked) n;`, with the read marked.
    fn for_of(&self, walked: ExprId) -> StmtId {
        let left = self.declare(VarKind::Const, "n", ExprId::NONE);
        let body = self.mark(self.name("n"));
        self.stmt(StmtKind::ForOf {
            left,
            expr: walked,
            body,
            is_await: false,
        })
    }

    /// `function f() { body }`
    fn function(&self, body: StmtId) -> StmtId {
        let mut file = self.file.borrow_mut();
        let function = Func {
            kind: FnKind::Decl,
            flags: Flags::empty(),
            name: self.atom("f"),
            name_pos: 0,
            type_params: Span::EMPTY,
            params: Span::EMPTY,
            this_param: ParamId::NONE,
            ret: TypeNodeId::NONE,
            body: FnBody::Block(file.list(&[body])),
            anchor: 0,
            start: 0,
            text_start: 0,
            is_strict: false,
            is_strict_by_syntax: false,
        };
        let function = file.add_fn(function);
        file.stmt(StmtKind::Fn(function), 0)
    }
}

fn text_of(atoms: &Interner<'_>, value: Constant) -> String {
    match value {
        Constant::Undefined => "undefined".to_owned(),
        Constant::Null => "null".to_owned(),
        Constant::Boolean(value) => value.to_string(),
        Constant::Number(value) => value.to_string(),
        Constant::String(text) | Constant::BigInt(text) => {
            String::from_utf8_lossy(atoms.bytes(text)).into_owned()
        }
    }
}

/// `build` returns the statements of the file. The result has one string per marked expression, in marking order: its values joined by ` | `, or
/// an empty string if they are unknown.
fn sets_of(build: impl FnOnce(&Tree<'_>) -> Vec<StmtId>) -> Vec<String> {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let tree = Tree {
        atoms,
        file: RefCell::default(),
        marked: RefCell::default(),
    };
    let body = build(&tree);
    let mut file = tree.file.into_inner();
    file.body = file.list(&body);
    let (mut hir, _) = file.into_arena(arena, &session);
    hir.finish_nodes();
    let options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let fold_options = FoldOptions {
        max_string_bytes: MAX_STRING_BYTES,
        ..FoldOptions::default()
    };
    let fold = FoldInputs::new(fold_options, arena);
    let bound = bind(&hir, options, &atoms, arena);
    assert!(!bound.ran_out_of_stack);
    let decisions = fold_file(&hir, &bound, &fold, &FILE_INPUTS, &atoms, arena).decisions;
    let mut known = KnownSets::new(&hir, &bound, &decisions, &atoms);
    let marked = tree.marked.into_inner();
    let sets = marked.iter().map(|&e| {
        let values = known.of(e).iter();
        let values: Vec<String> = values.map(|&value| text_of(&atoms, value)).collect();
        values.join(" | ")
    });
    sets.collect()
}

#[test]
#[cfg_attr(miri, ignore)]
fn arms() {
    let sets = sets_of(|t| {
        vec![
            t.mark(t.either("a", "b")),
            t.mark(t.cond(t.name("c"), t.text("a"), t.name("d"))),
        ]
    });
    assert_eq!(sets, ["a | b", ""]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn choices() {
    let sets = sets_of(|t| {
        let text_or = |other: ExprKind| t.cond(t.name("c"), t.text("a"), t.expr(other));
        vec![
            t.mark(t.binary(BinOp::Or, text_or(ExprKind::False), t.text("b"))),
            t.mark(t.binary(BinOp::And, text_or(ExprKind::False), t.text("b"))),
            t.mark(t.binary(BinOp::Nullish, text_or(ExprKind::Null), t.text("b"))),
            t.mark(t.binary(BinOp::Or, text_or(ExprKind::False), t.name("d"))),
            t.mark(t.binary(BinOp::Or, t.either("a", "b"), t.name("d"))),
        ]
    });
    assert_eq!(sets, ["a | b", "false | b", "a | b", "", "a | b"]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn dead_code() {
    let sets = sets_of(|t| {
        vec![
            t.mark(t.cond(t.expr(ExprKind::False), t.text("z"), t.either("a", "b"))),
            t.declare(VarKind::Const, "list", t.letters()),
            t.stmt(StmtKind::If {
                test: t.expr(ExprKind::False),
                yes: t.push_to("list"),
                no: StmtId::NONE,
            }),
            t.for_of(t.name("list")),
        ]
    });
    assert_eq!(sets, ["a | b", "a | b"]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn products() {
    let sets = sets_of(|t| {
        let number_or = |test: &str, text: &str| t.cond(t.name(test), t.number(1.0), t.text(text));
        vec![
            t.mark(t.binary(BinOp::Add, number_or("c", "a"), number_or("d", "b"))),
            t.mark(t.template("<", t.either("a", "b"), ">")),
            t.mark(t.binary(BinOp::Add, t.either("a", "b"), t.name("d"))),
        ]
    });
    assert_eq!(sets, ["2 | 1b | a1 | ab", "<a> | <b>", ""]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn dead_zone() {
    let sets = sets_of(|t| {
        vec![
            t.mark(t.name("x")),
            t.declare(VarKind::Const, "x", t.either("a", "b")),
            t.mark(t.name("x")),
        ]
    });
    assert_eq!(sets, ["", "a | b"]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn stored_let() {
    let sets = sets_of(|t| {
        vec![
            t.declare(VarKind::Let, "x", t.either("a", "b")),
            t.mark(t.name("x")),
            t.declare(VarKind::Let, "y", t.either("a", "b")),
            t.function(t.stmt(StmtKind::Expr(t.expr(ExprKind::Assign {
                op: None,
                target: t.name("y"),
                value: t.name("d"),
            })))),
            t.mark(t.name("y")),
        ]
    });
    assert_eq!(sets, ["a | b", ""]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn using_alone() {
    let sets = sets_of(|t| {
        let nothing = t.cond(
            t.name("c"),
            t.expr(ExprKind::Null),
            t.expr(ExprKind::Unary {
                op: UnOp::Void,
                operand: t.number(0.0),
            }),
        );
        vec![t.declare(VarKind::Using, "x", nothing), t.mark(t.name("x"))]
    });
    assert_eq!(sets, ["null | undefined"]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn lists() {
    let sets = sets_of(|t| {
        vec![
            t.for_of(t.letters()),
            t.for_of(t.array(&[t.text("a"), t.expr(ExprKind::Spread(t.name("d")))])),
        ]
    });
    assert_eq!(sets, ["a | b", ""]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn named_lists() {
    let sets = sets_of(|t| {
        vec![
            t.declare(VarKind::Const, "list", t.letters()),
            t.for_of(t.name("list")),
            t.declare(VarKind::Const, "grown", t.letters()),
            t.push_to("grown"),
            t.for_of(t.name("grown")),
        ]
    });
    assert_eq!(sets, ["a | b", ""]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn limit() {
    let sets = sets_of(|t| {
        let walk_numbers = |count: usize| {
            let numbers = (0..count as u32).map(|number| t.number(f64::from(number)));
            let numbers: Vec<ExprId> = numbers.collect();
            t.for_of(t.array(&numbers))
        };
        vec![
            walk_numbers(MOST_VALUES_IN_A_KNOWN_SET),
            walk_numbers(MOST_VALUES_IN_A_KNOWN_SET + 1),
        ]
    });
    assert_eq!(sets[0].split(" | ").count(), MOST_VALUES_IN_A_KNOWN_SET);
    assert_eq!(sets[1], "");
}

#[test]
#[cfg_attr(miri, ignore)]
fn order() {
    let sets = sets_of(|t| {
        vec![
            t.mark(t.cond(t.name("d"), t.text("b"), t.either("a", "b"))),
            t.mark(t.cond(
                t.name("c"),
                t.number(0.0),
                t.expr(ExprKind::Unary {
                    op: UnOp::Minus,
                    operand: t.number(0.0),
                }),
            )),
            t.mark(t.either("a", "a")),
        ]
    });
    assert_eq!(sets, ["b | a", "0 | -0", "a"]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn one_value() {
    let sets = sets_of(|t| vec![t.for_of(t.array(&[t.text("a")]))]);
    assert_eq!(sets, ["a"]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn one_value_alone() {
    let sets = sets_of(|t| {
        vec![
            t.declare(VarKind::Let, "a", t.text("x")),
            t.declare(VarKind::Let, "b", t.name("a")),
            t.mark(t.name("b")),
        ]
    });
    assert_eq!(sets, ["x"]);
}
