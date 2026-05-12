//! JSON serialization for the shell AST, matching Zig `std.json.fmt(v, .{})`.
//!
//! Port of the implicit serialization the Zig side gets for free via
//! `std.json.Stringify.write` reflection (vendor/zig/lib/std/json/Stringify.zig).
//! Only the testing APIs (`shellInternals.lex` / `.parse`) consume this, so the
//! shape is dictated by `test/js/bun/shell/{lex,parse}.test.ts`:
//!   - struct           → `{"field":value,...}` in field-declaration order
//!   - `[]T`            → JSON array
//!   - `[]const u8`     → JSON string (encodeJsonString, default options)
//!   - `enum`           → `"tag_name"`
//!   - `union(enum)`    → `{"tag":payload}`; void payload → `{"tag":{}}`
//!   - `?T`             → `null` or value
//!   - `*T`             → serialized as the pointee
//!   - `packed struct`  → like a struct (RedirectFlags emits each bool field)
//!   - `SmolList`       → JSON array (custom `jsonStringify` writes the slice)

use core::fmt::{self, Write};

use super::parse::SmolList;
use super::parse::ast::{
    Assign, Atom, Binary, BinaryOp, Cmd, CmdSubst, CompoundAtom, CondExpr, CondExprOp, Expr, If,
    JSBuf, Pipeline, PipelineItem, Redirect, RedirectFlags, Script, SimpleAtom, Stmt, Subshell,
};

// ───────────────────────────── primitives ─────────────────────────────

pub use bun_core::fmt::encode_json_string;

#[inline]
fn write_bool(w: &mut impl Write, b: bool) -> fmt::Result {
    w.write_str(if b { "true" } else { "false" })
}

/// Serialize a slice as a JSON array.
fn write_array<W: Write, T>(
    w: &mut W,
    items: &[T],
    mut elem: impl FnMut(&mut W, &T) -> fmt::Result,
) -> fmt::Result {
    w.write_char('[')?;
    for (i, e) in items.iter().enumerate() {
        if i != 0 {
            w.write_char(',')?;
        }
        elem(w, e)?;
    }
    w.write_char(']')
}

// ───────────────────────────── RedirectFlags ──────────────────────────
// Zig: `packed struct(u8)` → struct serialization in field-declaration order.

pub fn write_redirect_flags(w: &mut impl Write, r: RedirectFlags) -> fmt::Result {
    w.write_str("{\"stdin\":")?;
    write_bool(w, r.stdin())?;
    w.write_str(",\"stdout\":")?;
    write_bool(w, r.stdout())?;
    w.write_str(",\"stderr\":")?;
    write_bool(w, r.stderr())?;
    w.write_str(",\"append\":")?;
    write_bool(w, r.append())?;
    w.write_str(",\"duplicate_out\":")?;
    write_bool(w, r.duplicate_out())?;
    // `__unused: u3 = 0` — always 0.
    w.write_str(",\"__unused\":0}")
}

// ───────────────────────────── AST writers ────────────────────────────

fn write_script(w: &mut impl Write, s: &Script<'_>) -> fmt::Result {
    w.write_str("{\"stmts\":")?;
    write_array(w, s.stmts, write_stmt)?;
    w.write_char('}')
}

fn write_stmt(w: &mut impl Write, s: &Stmt<'_>) -> fmt::Result {
    w.write_str("{\"exprs\":")?;
    write_array(w, s.exprs, write_expr)?;
    w.write_char('}')
}

fn write_stmt_smol<const N: usize>(w: &mut impl Write, s: &SmolList<Stmt<'_>, N>) -> fmt::Result {
    write_array(w, s.slice(), write_stmt)
}

fn write_expr(w: &mut impl Write, e: &Expr<'_>) -> fmt::Result {
    // union(enum) → {"tag":payload}
    match e {
        Expr::Assign(a) => {
            w.write_str("{\"assign\":")?;
            write_array(w, a, write_assign)?;
        }
        Expr::Binary(b) => {
            w.write_str("{\"binary\":")?;
            write_binary(w, b)?;
        }
        Expr::Pipeline(p) => {
            w.write_str("{\"pipeline\":")?;
            write_pipeline(w, p)?;
        }
        Expr::Cmd(c) => {
            w.write_str("{\"cmd\":")?;
            write_cmd(w, c)?;
        }
        Expr::Subshell(s) => {
            w.write_str("{\"subshell\":")?;
            write_subshell(w, s)?;
        }
        Expr::If(i) => {
            w.write_str("{\"if\":")?;
            write_if(w, i)?;
        }
        Expr::CondExpr(c) => {
            w.write_str("{\"condexpr\":")?;
            write_condexpr(w, c)?;
        }
        Expr::Async(a) => {
            w.write_str("{\"async\":")?;
            write_expr(w, a)?;
        }
    }
    w.write_char('}')
}

fn write_binary(w: &mut impl Write, b: &Binary<'_>) -> fmt::Result {
    w.write_str("{\"op\":")?;
    encode_json_string(
        w,
        match b.op {
            BinaryOp::And => b"And",
            BinaryOp::Or => b"Or",
        },
    )?;
    w.write_str(",\"left\":")?;
    write_expr(w, &b.left)?;
    w.write_str(",\"right\":")?;
    write_expr(w, &b.right)?;
    w.write_char('}')
}

fn write_pipeline(w: &mut impl Write, p: &Pipeline<'_>) -> fmt::Result {
    w.write_str("{\"items\":")?;
    write_array(w, p.items, write_pipeline_item)?;
    w.write_char('}')
}

fn write_pipeline_item(w: &mut impl Write, p: &PipelineItem<'_>) -> fmt::Result {
    match p {
        PipelineItem::Cmd(c) => {
            w.write_str("{\"cmd\":")?;
            write_cmd(w, c)?;
        }
        PipelineItem::Assigns(a) => {
            w.write_str("{\"assigns\":")?;
            write_array(w, a, write_assign)?;
        }
        PipelineItem::Subshell(s) => {
            w.write_str("{\"subshell\":")?;
            write_subshell(w, s)?;
        }
        PipelineItem::If(i) => {
            w.write_str("{\"if\":")?;
            write_if(w, i)?;
        }
        PipelineItem::CondExpr(c) => {
            w.write_str("{\"condexpr\":")?;
            write_condexpr(w, c)?;
        }
    }
    w.write_char('}')
}

fn write_subshell(w: &mut impl Write, s: &Subshell<'_>) -> fmt::Result {
    w.write_str("{\"script\":")?;
    write_script(w, &s.script)?;
    w.write_str(",\"redirect\":")?;
    match &s.redirect {
        None => w.write_str("null")?,
        Some(r) => write_redirect(w, r)?,
    }
    w.write_str(",\"redirect_flags\":")?;
    write_redirect_flags(w, s.redirect_flags)?;
    w.write_char('}')
}

fn write_if(w: &mut impl Write, i: &If<'_>) -> fmt::Result {
    w.write_str("{\"cond\":")?;
    write_stmt_smol(w, &i.cond)?;
    w.write_str(",\"then\":")?;
    write_stmt_smol(w, &i.then)?;
    w.write_str(",\"else_parts\":")?;
    write_array(w, i.else_parts.slice(), |w, part| write_stmt_smol(w, part))?;
    w.write_char('}')
}

fn write_condexpr(w: &mut impl Write, c: &CondExpr<'_>) -> fmt::Result {
    w.write_str("{\"op\":")?;
    let tag: &'static str = c.op.into();
    encode_json_string(w, tag.as_bytes())?;
    w.write_str(",\"args\":")?;
    write_array(w, c.args.slice(), write_atom)?;
    w.write_char('}')
}

fn write_assign(w: &mut impl Write, a: &Assign<'_>) -> fmt::Result {
    w.write_str("{\"label\":")?;
    encode_json_string(w, a.label)?;
    w.write_str(",\"value\":")?;
    write_atom(w, &a.value)?;
    w.write_char('}')
}

fn write_cmd(w: &mut impl Write, c: &Cmd<'_>) -> fmt::Result {
    w.write_str("{\"assigns\":")?;
    write_array(w, c.assigns, write_assign)?;
    w.write_str(",\"name_and_args\":")?;
    write_array(w, c.name_and_args, write_atom)?;
    w.write_str(",\"redirect\":")?;
    write_redirect_flags(w, c.redirect)?;
    w.write_str(",\"redirect_file\":")?;
    match &c.redirect_file {
        None => w.write_str("null")?,
        Some(r) => write_redirect(w, r)?,
    }
    w.write_char('}')
}

fn write_redirect(w: &mut impl Write, r: &Redirect<'_>) -> fmt::Result {
    match r {
        Redirect::Atom(a) => {
            w.write_str("{\"atom\":")?;
            write_atom(w, a)?;
        }
        Redirect::JsBuf(j) => {
            w.write_str("{\"jsbuf\":")?;
            write_jsbuf(w, j)?;
        }
    }
    w.write_char('}')
}

fn write_jsbuf(w: &mut impl Write, j: &JSBuf) -> fmt::Result {
    write!(w, "{{\"idx\":{}}}", j.idx)
}

fn write_atom(w: &mut impl Write, a: &Atom<'_>) -> fmt::Result {
    match a {
        Atom::Simple(s) => {
            w.write_str("{\"simple\":")?;
            write_simple_atom(w, s)?;
        }
        Atom::Compound(c) => {
            w.write_str("{\"compound\":")?;
            write_compound_atom(w, c)?;
        }
    }
    w.write_char('}')
}

fn write_simple_atom(w: &mut impl Write, s: &SimpleAtom<'_>) -> fmt::Result {
    match s {
        SimpleAtom::Var(v) => {
            w.write_str("{\"Var\":")?;
            encode_json_string(w, v)?;
        }
        SimpleAtom::VarArgv(n) => {
            write!(w, "{{\"VarArgv\":{}", n)?;
        }
        SimpleAtom::Text(t) => {
            w.write_str("{\"Text\":")?;
            encode_json_string(w, t)?;
        }
        SimpleAtom::QuotedEmpty => w.write_str("{\"quoted_empty\":{}")?,
        SimpleAtom::Asterisk => w.write_str("{\"asterisk\":{}")?,
        SimpleAtom::DoubleAsterisk => w.write_str("{\"double_asterisk\":{}")?,
        SimpleAtom::BraceBegin => w.write_str("{\"brace_begin\":{}")?,
        SimpleAtom::BraceEnd => w.write_str("{\"brace_end\":{}")?,
        SimpleAtom::Comma => w.write_str("{\"comma\":{}")?,
        SimpleAtom::Tilde => w.write_str("{\"tilde\":{}")?,
        SimpleAtom::CmdSubst(c) => {
            w.write_str("{\"cmd_subst\":")?;
            write_cmd_subst(w, c)?;
        }
    }
    w.write_char('}')
}

fn write_cmd_subst(w: &mut impl Write, c: &CmdSubst<'_>) -> fmt::Result {
    w.write_str("{\"script\":")?;
    write_script(w, &c.script)?;
    w.write_str(",\"quoted\":")?;
    write_bool(w, c.quoted)?;
    w.write_char('}')
}

fn write_compound_atom(w: &mut impl Write, c: &CompoundAtom<'_>) -> fmt::Result {
    w.write_str("{\"atoms\":")?;
    write_array(w, c.atoms, write_simple_atom)?;
    w.write_str(",\"brace_expansion_hint\":")?;
    write_bool(w, c.brace_expansion_hint)?;
    w.write_str(",\"glob_hint\":")?;
    write_bool(w, c.glob_hint)?;
    w.write_char('}')
}

// ───────────────────────────── Display adapters ──────────────────────────

/// `Display` adapter mirroring Zig's `std.json.fmt(script_ast, .{})`.
pub fn script_json_fmt<'a, 'b>(script: &'b Script<'a>) -> impl fmt::Display + 'b {
    ScriptJsonFmt(script)
}

struct ScriptJsonFmt<'a, 'b>(&'b Script<'a>);

impl fmt::Display for ScriptJsonFmt<'_, '_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write_script(f, self.0)
    }
}
