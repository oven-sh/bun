//! `Bun.Transpiler.prototype.unstable_parse` — `bun_ast::Ast` → ASCII JSON → `JSON.parse`.

use bun_ast::{
    self as ast, ArrayBinding, Binding, Case, Catch, ClauseItem, E, EnumValue, Expr, ExprData,
    Finally, G, ImportRecord, Loc, OpCode, OptionalChain, Ref, Stmt, StmtData, StmtOrExpr, Symbol,
    binding::Data as BData, flags,
};
use bun_collections::VecExt;
use bun_core::fmt::{ItoaBuf, itoa};
use bun_core::{StackCheck, strings};
use std::io::Write as _;

/// Stack recursion exceeded while serializing a deeply nested AST.
pub(crate) struct StackOverflow;

pub(crate) fn ast_to_json(ast: &ast::Ast<'_>, buf: &mut Vec<u8>) -> Result<(), StackOverflow> {
    buf.reserve(ast.approximate_newline_count.saturating_mul(64).max(256));
    let mut w = Writer {
        buf,
        symbols: ast.symbols.as_slice(),
        import_records: ast.import_records.as_slice(),
        stack: StackCheck::init(),
    };

    w.raw(b"{\"kind\":\"ast\"");

    w.key("hashbang");
    if ast.hashbang.slice().is_empty() {
        w.null();
    } else {
        w.str(ast.hashbang.slice());
    }

    w.key("directive");
    match &ast.directive {
        Some(d) => w.str(d.slice()),
        None => w.null(),
    }

    w.key("exportsKind");
    w.enum_(ast.exports_kind);

    w.key("approximateNewlineCount");
    w.uint(ast.approximate_newline_count as u64);

    w.key("importRecords");
    w.raw(b"[");
    for (i, rec) in ast.import_records.as_slice().iter().enumerate() {
        if i > 0 {
            w.raw(b",");
        }
        w.import_record(rec);
    }
    w.raw(b"]");

    w.key("symbols");
    w.raw(b"[");
    for (i, sym) in ast.symbols.as_slice().iter().enumerate() {
        if i > 0 {
            w.raw(b",");
        }
        w.raw(b"{\"name\":");
        w.str(sym.original_name.slice());
        w.key("kind");
        w.enum_(sym.kind);
        w.raw(b"}");
    }
    w.raw(b"]");

    // Part boundaries are a bundler tree-shaking concern; flatten.
    w.key("stmts");
    w.raw(b"[");
    let mut first = true;
    for part in ast.parts.as_slice().iter() {
        for s in part.stmts.iter() {
            if !first {
                w.raw(b",");
            }
            first = false;
            w.stmt(s)?;
        }
    }
    w.raw(b"]");

    w.raw(b"}");
    Ok(())
}

struct Writer<'a> {
    buf: &'a mut Vec<u8>,
    symbols: &'a [Symbol],
    import_records: &'a [ImportRecord],
    stack: StackCheck,
}

// ─── low-level JSON emitters ───────────────────────────────────────────────
impl<'a> Writer<'a> {
    #[inline]
    fn raw(&mut self, b: &[u8]) {
        self.buf.extend_from_slice(b);
    }

    #[inline]
    fn key(&mut self, k: &'static str) {
        self.raw(b",\"");
        self.raw(k.as_bytes());
        self.raw(b"\":");
    }

    /// `{"kind":"<kind>","loc":<loc>` — caller appends fields then `end()`.
    #[inline]
    fn begin(&mut self, kind: &'static str, loc: Loc) {
        self.raw(b"{\"kind\":\"");
        self.raw(kind.as_bytes());
        self.raw(b"\",\"loc\":");
        self.loc(loc);
    }

    #[inline]
    fn end(&mut self) {
        self.raw(b"}");
    }

    /// ASCII-only JSON string (`write_json_string` emits `\v`/`\x07`, invalid JSON).
    fn str(&mut self, s: &[u8]) {
        self.raw(b"\"");
        let mut i = 0;
        while i < s.len() {
            let b = s[i];
            if b >= 0x20 && b < 0x80 && b != b'"' && b != b'\\' {
                let start = i;
                i += 1;
                while i < s.len() {
                    let c = s[i];
                    if !(0x20..0x80).contains(&c) || c == b'"' || c == b'\\' {
                        break;
                    }
                    i += 1;
                }
                self.raw(&s[start..i]);
                continue;
            }
            match b {
                b'"' => self.raw(b"\\\""),
                b'\\' => self.raw(b"\\\\"),
                b'\n' => self.raw(b"\\n"),
                b'\r' => self.raw(b"\\r"),
                b'\t' => self.raw(b"\\t"),
                0x08 => self.raw(b"\\b"),
                0x0C => self.raw(b"\\f"),
                0x00..=0x1F => self.uescape(b as u32),
                _ => {
                    let w = strings::wtf8_byte_sequence_length_with_invalid(b) as usize;
                    let w = w.min(s.len() - i);
                    let mut bytes = [0u8; 4];
                    bytes[..w].copy_from_slice(&s[i..i + w]);
                    let cp = strings::decode_wtf8_rune_t::<u32>(bytes, w as u8, 0xFFFD);
                    self.codepoint(cp);
                    i += w;
                    continue;
                }
            }
            i += 1;
        }
        self.raw(b"\"");
    }

    fn str16(&mut self, s: &[u16]) {
        self.raw(b"\"");
        for &u in s {
            let b = u as u8;
            if u < 0x80 && u >= 0x20 && b != b'"' && b != b'\\' {
                self.buf.push(b);
                continue;
            }
            match u {
                0x22 => self.raw(b"\\\""),
                0x5C => self.raw(b"\\\\"),
                0x0A => self.raw(b"\\n"),
                0x0D => self.raw(b"\\r"),
                0x09 => self.raw(b"\\t"),
                0x08 => self.raw(b"\\b"),
                0x0C => self.raw(b"\\f"),
                // One `\uNNNN` per code unit; surrogate halves round-trip.
                _ => self.uescape(u as u32),
            }
        }
        self.raw(b"\"");
    }

    #[inline]
    fn uescape(&mut self, u: u32) {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        self.raw(&[
            b'\\',
            b'u',
            HEX[(u >> 12 & 0xF) as usize],
            HEX[(u >> 8 & 0xF) as usize],
            HEX[(u >> 4 & 0xF) as usize],
            HEX[(u & 0xF) as usize],
        ]);
    }

    #[inline]
    fn codepoint(&mut self, cp: u32) {
        if cp <= 0xFFFF {
            self.uescape(cp);
        } else {
            let cp = cp - 0x1_0000;
            self.uescape(0xD800 | (cp >> 10));
            self.uescape(0xDC00 | (cp & 0x3FF));
        }
    }

    fn e_string(&mut self, s: &E::EString) {
        if s.next.is_some() && s.is_utf8() {
            let mut bytes: Vec<u8> = Vec::with_capacity(s.rope_len as usize);
            bytes.extend_from_slice(s.slice8());
            let mut next = s.next;
            while let Some(part) = next {
                let part = part.get();
                bytes.extend_from_slice(&part.data);
                next = part.next;
            }
            return self.str(&bytes);
        }
        if s.is_utf16 {
            self.str16(s.slice16());
        } else {
            self.str(s.slice8());
        }
    }

    #[inline]
    fn int(&mut self, n: i64) {
        let mut b = ItoaBuf::new();
        self.raw(itoa(&mut b, n));
    }

    #[inline]
    fn uint(&mut self, n: u64) {
        let mut b = ItoaBuf::new();
        self.raw(itoa(&mut b, n));
    }

    fn f64(&mut self, n: f64) {
        // JSON has no NaN/Infinity literals.
        if !n.is_finite() {
            return self.null();
        }
        if n == n.trunc() && n.abs() < (1u64 << 53) as f64 {
            return self.int(n as i64);
        }
        let _ = write!(self.buf, "{}", n);
    }

    #[inline]
    fn bool_(&mut self, b: bool) {
        self.raw(if b { b"true" } else { b"false" });
    }

    #[inline]
    fn null(&mut self) {
        self.raw(b"null");
    }

    #[inline]
    fn loc(&mut self, loc: Loc) {
        if loc.start < 0 {
            self.null();
        } else {
            self.int(loc.start as i64);
        }
    }

    /// Any `strum::IntoStaticStr` enum → its snake_case string.
    #[inline]
    fn enum_<T: Into<&'static str>>(&mut self, v: T) {
        self.raw(b"\"");
        self.raw(v.into().as_bytes());
        self.raw(b"\"");
    }

    /// Resolve a `Ref` to its source-text name (or `null` for unbound/invalid).
    fn ref_(&mut self, r: Ref) {
        if !r.is_valid() {
            return self.null();
        }
        let idx = r.inner_index() as usize;
        if let Some(sym) = self.symbols.get(idx) {
            self.str(sym.original_name.slice());
        } else {
            self.null();
        }
    }

    fn loc_ref(&mut self, lr: ast::LocRef) {
        self.raw(b"{\"loc\":");
        self.loc(lr.loc);
        self.key("name");
        self.ref_(lr.ref_);
        self.end();
    }

    fn opt_loc_ref(&mut self, lr: Option<ast::LocRef>) {
        match lr {
            Some(lr) => self.loc_ref(lr),
            None => self.null(),
        }
    }

    fn optional_chain(&mut self, oc: Option<OptionalChain>) {
        match oc {
            Some(c) => self.enum_(c),
            None => self.null(),
        }
    }

    /// `,[<comma-sep f(each)>]`
    fn arr<T>(
        &mut self,
        items: impl IntoIterator<Item = T>,
        mut f: impl FnMut(&mut Self, T) -> Result<(), StackOverflow>,
    ) -> Result<(), StackOverflow> {
        self.raw(b"[");
        let mut first = true;
        for it in items {
            if !first {
                self.raw(b",");
            }
            first = false;
            f(self, it)?;
        }
        self.raw(b"]");
        Ok(())
    }

    fn import_record(&mut self, rec: &ImportRecord) {
        self.raw(b"{\"path\":");
        self.str(rec.path.text);
        self.key("kind");
        self.str(rec.kind.label());
        self.end();
    }

    fn import_record_idx(&mut self, idx: u32) {
        match self.import_records.get(idx as usize) {
            Some(rec) => {
                // Inline the path for convenience; the index is still emitted.
                self.raw(b"{\"index\":");
                self.uint(idx as u64);
                self.key("path");
                self.str(rec.path.text);
                self.key("kind");
                self.str(rec.kind.label());
                self.end();
            }
            None => self.null(),
        }
    }
}

// ─── statements ────────────────────────────────────────────────────────────
impl<'a> Writer<'a> {
    fn stmt(&mut self, s: &Stmt) -> Result<(), StackOverflow> {
        if !self.stack.is_safe_to_recurse() {
            return Err(StackOverflow);
        }
        let kind: &'static str = s.data.tag().into();
        self.begin(kind, s.loc);
        match &s.data {
            StmtData::SBlock(v) => {
                self.key("stmts");
                self.stmt_list(v.stmts.iter())?;
                self.key("closeBraceLoc");
                self.loc(v.close_brace_loc);
            }
            StmtData::SBreak(v) => {
                self.key("label");
                self.opt_loc_ref(v.label);
            }
            StmtData::SContinue(v) => {
                self.key("label");
                self.opt_loc_ref(v.label);
            }
            StmtData::SComment(v) => {
                self.key("text");
                self.str(v.text.slice());
            }
            StmtData::SDirective(v) => {
                self.key("value");
                self.str(v.value.slice());
            }
            StmtData::SDebugger(_) | StmtData::SEmpty(_) | StmtData::STypeScript(_) => {}
            StmtData::SDoWhile(v) => {
                self.key("body");
                self.stmt(&v.body)?;
                self.key("test");
                self.expr(&v.test)?;
            }
            StmtData::SWhile(v) => {
                self.key("test");
                self.expr(&v.test)?;
                self.key("body");
                self.stmt(&v.body)?;
            }
            StmtData::SWith(v) => {
                self.key("value");
                self.expr(&v.value)?;
                self.key("body");
                self.stmt(&v.body)?;
            }
            StmtData::SExpr(v) => {
                self.key("value");
                self.expr(&v.value)?;
            }
            StmtData::SIf(v) => {
                self.key("test");
                self.expr(&v.test)?;
                self.key("yes");
                self.stmt(&v.yes)?;
                self.key("no");
                match v.no {
                    Some(no) => self.stmt(&no)?,
                    None => self.null(),
                }
            }
            StmtData::SFor(v) => {
                self.key("init");
                match v.init {
                    Some(init) => self.stmt(&init)?,
                    None => self.null(),
                }
                self.key("test");
                self.opt_expr(v.test)?;
                self.key("update");
                self.opt_expr(v.update)?;
                self.key("body");
                self.stmt(&v.body)?;
            }
            StmtData::SForIn(v) => {
                self.key("init");
                self.stmt(&v.init)?;
                self.key("value");
                self.expr(&v.value)?;
                self.key("body");
                self.stmt(&v.body)?;
            }
            StmtData::SForOf(v) => {
                self.key("isAwait");
                self.bool_(v.is_await);
                self.key("init");
                self.stmt(&v.init)?;
                self.key("value");
                self.expr(&v.value)?;
                self.key("body");
                self.stmt(&v.body)?;
            }
            StmtData::SReturn(v) => {
                self.key("value");
                self.opt_expr(v.value)?;
            }
            StmtData::SThrow(v) => {
                self.key("value");
                self.expr(&v.value)?;
            }
            StmtData::SLabel(v) => {
                self.key("name");
                self.loc_ref(v.name);
                self.key("stmt");
                self.stmt(&v.stmt)?;
            }
            StmtData::SSwitch(v) => {
                self.key("test");
                self.expr(&v.test)?;
                self.key("cases");
                self.arr(v.cases.iter(), |w, c| w.case(c))?;
            }
            StmtData::STry(v) => {
                self.key("body");
                self.stmt_list(v.body.iter())?;
                self.key("catch");
                match &v.catch {
                    Some(c) => self.catch(c)?,
                    None => self.null(),
                }
                self.key("finally");
                match &v.finally {
                    Some(f) => self.finally(f)?,
                    None => self.null(),
                }
            }
            StmtData::SClass(v) => {
                self.key("class");
                self.g_class(&v.class)?;
                self.key("isExport");
                self.bool_(v.is_export);
            }
            StmtData::SFunction(v) => {
                self.key("func");
                self.g_fn(&v.func)?;
            }
            StmtData::SLocal(v) => {
                self.key("declKind");
                self.enum_(v.kind);
                self.key("isExport");
                self.bool_(v.is_export);
                self.key("decls");
                self.arr(v.decls.slice().iter(), |w, d| w.g_decl(d))?;
            }
            StmtData::SEnum(v) => {
                self.key("name");
                self.loc_ref(v.name);
                self.key("isExport");
                self.bool_(v.is_export);
                self.key("values");
                self.arr(v.values.iter(), |w, ev| w.enum_value(ev))?;
            }
            StmtData::SNamespace(v) => {
                self.key("name");
                self.loc_ref(v.name);
                self.key("isExport");
                self.bool_(v.is_export);
                self.key("stmts");
                self.stmt_list(v.stmts.iter())?;
            }
            StmtData::SImport(v) => {
                self.key("namespace");
                self.ref_(v.namespace_ref);
                self.key("defaultName");
                self.opt_loc_ref(v.default_name);
                self.key("items");
                self.arr(v.items.iter(), |w, c| {
                    w.clause_item(c);
                    Ok(())
                })?;
                self.key("starNameLoc");
                self.loc(v.star_name_loc);
                self.key("phaseDefer");
                self.bool_(v.phase_defer);
                self.key("importRecord");
                self.import_record_idx(v.import_record_index);
            }
            StmtData::SExportClause(v) => {
                self.key("items");
                self.arr(v.items.iter(), |w, c| {
                    w.clause_item(c);
                    Ok(())
                })?;
            }
            StmtData::SExportFrom(v) => {
                self.key("items");
                self.arr(v.items.iter(), |w, c| {
                    w.clause_item(c);
                    Ok(())
                })?;
                self.key("namespace");
                self.ref_(v.namespace_ref);
                self.key("importRecord");
                self.import_record_idx(v.import_record_index);
            }
            StmtData::SExportStar(v) => {
                self.key("namespace");
                self.ref_(v.namespace_ref);
                self.key("alias");
                match &v.alias {
                    Some(a) => {
                        self.raw(b"{\"loc\":");
                        self.loc(a.loc);
                        self.key("name");
                        self.str(a.original_name.slice());
                        self.end();
                    }
                    None => self.null(),
                }
                self.key("importRecord");
                self.import_record_idx(v.import_record_index);
            }
            StmtData::SExportEquals(v) => {
                self.key("value");
                self.expr(&v.value)?;
            }
            StmtData::SExportDefault(v) => {
                self.key("defaultName");
                self.loc_ref(v.default_name);
                self.key("value");
                match &v.value {
                    StmtOrExpr::Stmt(s) => self.stmt(s)?,
                    StmtOrExpr::Expr(e) => self.expr(e)?,
                }
            }
            StmtData::SLazyExport(v) => {
                self.key("value");
                self.expr(&Expr {
                    data: **v,
                    loc: s.loc,
                })?;
            }
        }
        self.end();
        Ok(())
    }

    #[inline]
    fn stmt_list<'s>(
        &mut self,
        items: impl Iterator<Item = &'s Stmt>,
    ) -> Result<(), StackOverflow> {
        self.arr(items, |w, s| w.stmt(s))
    }

    fn case(&mut self, c: &Case) -> Result<(), StackOverflow> {
        self.raw(b"{\"loc\":");
        self.loc(c.loc);
        self.key("value");
        self.opt_expr(c.value)?;
        self.key("body");
        self.stmt_list(c.body.iter())?;
        self.end();
        Ok(())
    }

    fn catch(&mut self, c: &Catch) -> Result<(), StackOverflow> {
        self.raw(b"{\"loc\":");
        self.loc(c.loc);
        self.key("binding");
        match c.binding {
            Some(b) => self.binding(&b)?,
            None => self.null(),
        }
        self.key("body");
        self.stmt_list(c.body.iter())?;
        self.end();
        Ok(())
    }

    fn finally(&mut self, f: &Finally) -> Result<(), StackOverflow> {
        self.raw(b"{\"loc\":");
        self.loc(f.loc);
        self.key("stmts");
        self.stmt_list(f.stmts.iter())?;
        self.end();
        Ok(())
    }

    fn clause_item(&mut self, c: &ClauseItem) {
        self.raw(b"{\"alias\":");
        self.str(c.alias.slice());
        self.key("aliasLoc");
        self.loc(c.alias_loc);
        self.key("name");
        self.loc_ref(c.name);
        self.key("originalName");
        self.str(c.original_name.slice());
        self.end();
    }

    fn enum_value(&mut self, ev: &EnumValue) -> Result<(), StackOverflow> {
        self.raw(b"{\"loc\":");
        self.loc(ev.loc);
        self.key("name");
        self.str(ev.name.slice());
        self.key("value");
        self.opt_expr(ev.value)?;
        self.end();
        Ok(())
    }
}

// ─── expressions ───────────────────────────────────────────────────────────
impl<'a> Writer<'a> {
    fn expr(&mut self, e: &Expr) -> Result<(), StackOverflow> {
        if !self.stack.is_safe_to_recurse() {
            return Err(StackOverflow);
        }
        let kind: &'static str = e.data.tag().into();
        self.begin(kind, e.loc);
        match &e.data {
            ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EMissing(_)
            | ExprData::EThis(_)
            | ExprData::ESuper(_)
            | ExprData::EImportMeta(_)
            | ExprData::ENewTarget(_)
            | ExprData::ERequireCallTarget
            | ExprData::ERequireResolveCallTarget
            | ExprData::ERequireMain => {}
            ExprData::EBoolean(v) | ExprData::EBranchBoolean(v) => {
                self.key("value");
                self.bool_(v.value);
            }
            ExprData::ENumber(v) => {
                self.key("value");
                self.f64(v.value());
            }
            ExprData::EBigInt(v) => {
                self.key("value");
                self.str(v.value.slice());
            }
            ExprData::EString(v) => {
                self.key("value");
                self.e_string(v);
            }
            ExprData::EIdentifier(v) => {
                self.key("name");
                self.ref_(v.ref_);
            }
            ExprData::EImportIdentifier(v) => {
                self.key("name");
                self.ref_(v.ref_);
                self.key("wasOriginallyIdentifier");
                self.bool_(v.was_originally_identifier());
            }
            ExprData::EPrivateIdentifier(v) => {
                self.key("name");
                self.ref_(v.ref_);
            }
            ExprData::ECommonjsExportIdentifier(v) => {
                self.key("name");
                self.ref_(v.ref_);
            }
            ExprData::ENameOfSymbol(v) => {
                self.key("name");
                self.ref_(v.ref_);
            }
            ExprData::EUnary(v) => {
                self.key("op");
                self.op(v.op);
                self.key("value");
                self.expr(&v.value)?;
            }
            ExprData::EBinary(v) => {
                self.key("op");
                self.op(v.op);
                self.key("left");
                self.expr(&v.left)?;
                self.key("right");
                self.expr(&v.right)?;
            }
            ExprData::EArray(v) => {
                self.key("items");
                self.expr_list(v.items.slice().iter())?;
                self.key("isParenthesized");
                self.bool_(v.is_parenthesized);
            }
            ExprData::EObject(v) => {
                self.key("properties");
                self.arr(v.properties.slice().iter(), |w, p| w.g_property(p))?;
                self.key("isParenthesized");
                self.bool_(v.is_parenthesized);
            }
            ExprData::ESpread(v) => {
                self.key("value");
                self.expr(&v.value)?;
            }
            ExprData::EAwait(v) => {
                self.key("value");
                self.expr(&v.value)?;
            }
            ExprData::EYield(v) => {
                self.key("value");
                self.opt_expr(v.value)?;
                self.key("isStar");
                self.bool_(v.is_star);
            }
            ExprData::EIf(v) => {
                self.key("test");
                self.expr(&v.test)?;
                self.key("yes");
                self.expr(&v.yes)?;
                self.key("no");
                self.expr(&v.no)?;
            }
            ExprData::ENew(v) => {
                self.key("target");
                self.expr(&v.target)?;
                self.key("args");
                self.expr_list(v.args.slice().iter())?;
            }
            ExprData::ECall(v) => {
                self.key("target");
                self.expr(&v.target)?;
                self.key("args");
                self.expr_list(v.args.slice().iter())?;
                self.key("optionalChain");
                self.optional_chain(v.optional_chain);
                self.key("isDirectEval");
                self.bool_(v.is_direct_eval);
            }
            ExprData::EDot(v) => {
                self.key("target");
                self.expr(&v.target)?;
                self.key("name");
                self.str(v.name.slice());
                self.key("nameLoc");
                self.loc(v.name_loc);
                self.key("optionalChain");
                self.optional_chain(v.optional_chain);
            }
            ExprData::EIndex(v) => {
                self.key("target");
                self.expr(&v.target)?;
                self.key("index");
                self.expr(&v.index)?;
                self.key("optionalChain");
                self.optional_chain(v.optional_chain);
            }
            ExprData::EArrow(v) => {
                self.key("args");
                self.arr(v.args.iter(), |w, a| w.g_arg(a))?;
                self.key("body");
                self.g_fn_body(&v.body)?;
                self.key("isAsync");
                self.bool_(v.is_async);
                self.key("hasRestArg");
                self.bool_(v.has_rest_arg);
                self.key("preferExpr");
                self.bool_(v.prefer_expr);
            }
            ExprData::EFunction(v) => {
                self.key("func");
                self.g_fn(&v.func)?;
            }
            ExprData::EClass(v) => {
                self.key("class");
                self.g_class(v)?;
            }
            ExprData::EJsxElement(v) => {
                self.key("tag");
                self.opt_expr(v.tag)?;
                self.key("properties");
                self.arr(v.properties.slice().iter(), |w, p| w.g_property(p))?;
                self.key("children");
                self.expr_list(v.children.slice().iter())?;
            }
            ExprData::ETemplate(v) => {
                self.key("tag");
                self.opt_expr(v.tag)?;
                self.key("head");
                self.template_contents(&v.head);
                self.key("parts");
                self.arr(v.parts().iter(), |w, p| w.template_part(p))?;
            }
            ExprData::ERegExp(v) => {
                self.key("pattern");
                self.str(v.pattern());
                self.key("flags");
                self.str(v.flags());
            }
            ExprData::EImport(v) => {
                self.key("expr");
                self.expr(&v.expr)?;
                self.key("options");
                if matches!(v.options.data, ExprData::EMissing(_)) {
                    self.null();
                } else {
                    self.expr(&v.options)?;
                }
                self.key("importRecord");
                if v.is_import_record_null() {
                    self.null();
                } else {
                    self.import_record_idx(v.import_record_index);
                }
            }
            ExprData::ERequireString(v) => {
                self.key("importRecord");
                self.import_record_idx(v.import_record_index);
            }
            ExprData::ERequireResolveString(v) => {
                self.key("importRecord");
                self.import_record_idx(v.import_record_index);
            }
            ExprData::EImportMetaMain(v) => {
                self.key("inverted");
                self.bool_(v.inverted);
            }
            ExprData::ESpecial(v) => {
                self.key("special");
                self.str(match v {
                    E::Special::ModuleExports => b"module_exports",
                    E::Special::HotEnabled => b"hot_enabled",
                    E::Special::HotDisabled => b"hot_disabled",
                    E::Special::HotData => b"hot_data",
                    E::Special::HotAccept => b"hot_accept",
                    E::Special::HotAcceptVisited => b"hot_accept_visited",
                    E::Special::ResolvedSpecifierString(_) => b"resolved_specifier_string",
                });
            }
            ExprData::EInlinedEnum(v) => {
                self.key("value");
                self.expr(&v.value)?;
                self.key("comment");
                self.str(v.comment.slice());
            }
            ExprData::EObjectJSON(_) | ExprData::EArrayJSON(_) => {
                // JSON literal nodes only appear from the JSON/TOML parser path.
            }
        }
        self.end();
        Ok(())
    }

    #[inline]
    fn opt_expr(&mut self, e: Option<Expr>) -> Result<(), StackOverflow> {
        match e {
            Some(e) => self.expr(&e),
            None => {
                self.null();
                Ok(())
            }
        }
    }

    #[inline]
    fn expr_list<'e>(
        &mut self,
        items: impl Iterator<Item = &'e Expr>,
    ) -> Result<(), StackOverflow> {
        self.arr(items, |w, e| w.expr(e))
    }

    #[inline]
    fn op(&mut self, op: OpCode) {
        self.enum_(op);
    }

    fn template_contents(&mut self, tc: &E::TemplateContents) {
        match tc {
            E::TemplateContents::Cooked(s) => self.e_string(s),
            E::TemplateContents::Raw(s) => self.str(s.slice()),
        }
    }

    fn template_part(&mut self, p: &E::TemplatePart) -> Result<(), StackOverflow> {
        self.raw(b"{\"value\":");
        self.expr(&p.value)?;
        self.key("tailLoc");
        self.loc(p.tail_loc);
        self.key("tail");
        self.template_contents(&p.tail);
        self.end();
        Ok(())
    }
}

// ─── bindings ──────────────────────────────────────────────────────────────
impl<'a> Writer<'a> {
    fn binding(&mut self, b: &Binding) -> Result<(), StackOverflow> {
        if !self.stack.is_safe_to_recurse() {
            return Err(StackOverflow);
        }
        let kind: &'static str = b.data.tag().into();
        self.begin(kind, b.loc);
        match &b.data {
            BData::BMissing(_) => {}
            BData::BIdentifier(v) => {
                self.key("name");
                self.ref_(v.r#ref);
            }
            BData::BArray(v) => {
                self.key("items");
                self.arr(v.items().iter(), |w, it| w.array_binding(it))?;
                self.key("hasSpread");
                self.bool_(v.has_spread);
            }
            BData::BObject(v) => {
                self.key("properties");
                self.arr(v.properties().iter(), |w, p| w.b_property(p))?;
            }
        }
        self.end();
        Ok(())
    }

    fn array_binding(&mut self, ab: &ArrayBinding) -> Result<(), StackOverflow> {
        self.raw(b"{\"binding\":");
        self.binding(&ab.binding)?;
        self.key("defaultValue");
        self.opt_expr(ab.default_value)?;
        self.end();
        Ok(())
    }

    fn b_property(&mut self, p: &ast::b::Property) -> Result<(), StackOverflow> {
        self.raw(b"{\"key\":");
        self.expr(&p.key)?;
        self.key("value");
        self.binding(&p.value)?;
        self.key("defaultValue");
        match &p.default_value {
            Some(e) => self.expr(e)?,
            None => self.null(),
        }
        self.key("isSpread");
        self.bool_(p.flags.contains(flags::Property::IsSpread));
        self.key("isComputed");
        self.bool_(p.flags.contains(flags::Property::IsComputed));
        self.end();
        Ok(())
    }
}

// ─── shared G.* nodes ──────────────────────────────────────────────────────
impl<'a> Writer<'a> {
    fn g_decl(&mut self, d: &G::Decl) -> Result<(), StackOverflow> {
        self.raw(b"{\"binding\":");
        self.binding(&d.binding)?;
        self.key("value");
        self.opt_expr(d.value)?;
        self.end();
        Ok(())
    }

    fn g_arg(&mut self, a: &G::Arg) -> Result<(), StackOverflow> {
        self.raw(b"{\"binding\":");
        self.binding(&a.binding)?;
        self.key("default");
        self.opt_expr(a.default)?;
        self.key("tsDecorators");
        self.expr_list(a.ts_decorators.slice().iter())?;
        self.key("isTypescriptCtorField");
        self.bool_(a.is_typescript_ctor_field);
        self.end();
        Ok(())
    }

    fn g_fn_body(&mut self, b: &G::FnBody) -> Result<(), StackOverflow> {
        self.raw(b"{\"loc\":");
        self.loc(b.loc);
        self.key("stmts");
        self.stmt_list(b.stmts.iter())?;
        self.end();
        Ok(())
    }

    fn g_fn(&mut self, f: &G::Fn) -> Result<(), StackOverflow> {
        self.raw(b"{\"name\":");
        self.opt_loc_ref(f.name);
        self.key("args");
        self.arr(f.args.iter(), |w, a| w.g_arg(a))?;
        self.key("body");
        self.g_fn_body(&f.body)?;
        self.key("isAsync");
        self.bool_(f.flags.contains(flags::Function::IsAsync));
        self.key("isGenerator");
        self.bool_(f.flags.contains(flags::Function::IsGenerator));
        self.key("hasRestArg");
        self.bool_(f.flags.contains(flags::Function::HasRestArg));
        self.key("isExport");
        self.bool_(f.flags.contains(flags::Function::IsExport));
        self.end();
        Ok(())
    }

    fn g_property(&mut self, p: &G::Property) -> Result<(), StackOverflow> {
        self.raw(b"{\"kind\":");
        self.enum_(p.kind);
        self.key("key");
        self.opt_expr(p.key)?;
        self.key("value");
        self.opt_expr(p.value)?;
        self.key("initializer");
        self.opt_expr(p.initializer)?;
        self.key("tsDecorators");
        self.expr_list(p.ts_decorators.slice().iter())?;
        self.key("isComputed");
        self.bool_(p.flags.contains(flags::Property::IsComputed));
        self.key("isMethod");
        self.bool_(p.flags.contains(flags::Property::IsMethod));
        self.key("isStatic");
        self.bool_(p.flags.contains(flags::Property::IsStatic));
        self.key("isSpread");
        self.bool_(p.flags.contains(flags::Property::IsSpread));
        self.key("wasShorthand");
        self.bool_(p.flags.contains(flags::Property::WasShorthand));
        self.key("classStaticBlock");
        match p.class_static_block_ref() {
            Some(csb) => {
                self.raw(b"{\"loc\":");
                self.loc(csb.loc);
                self.key("stmts");
                self.stmt_list(csb.stmts.slice().iter())?;
                self.end();
            }
            None => self.null(),
        }
        self.end();
        Ok(())
    }

    fn g_class(&mut self, c: &G::Class) -> Result<(), StackOverflow> {
        self.raw(b"{\"name\":");
        self.opt_loc_ref(c.class_name);
        self.key("extends");
        self.opt_expr(c.extends)?;
        self.key("tsDecorators");
        self.expr_list(c.ts_decorators.slice().iter())?;
        self.key("properties");
        self.arr(c.properties.iter(), |w, p| w.g_property(p))?;
        self.key("hasDecorators");
        self.bool_(c.has_decorators);
        self.end();
        Ok(())
    }
}
