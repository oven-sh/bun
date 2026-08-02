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

pub(crate) enum SerializeError {
    /// Stack recursion exceeded while serializing a deeply nested AST.
    StackOverflow,
    /// Raw tape offsets/lengths are `u32`; input exceeds 4 GiB.
    TapeTooLarge,
}

/// Final tape (records + key table + strings) must be addressable by `u32`.
const TAPE_MAX_LEN: usize = u32::MAX as usize;

pub(crate) fn ast_to_json(ast: &ast::Ast<'_>, buf: &mut Vec<u8>) -> Result<(), SerializeError> {
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
                    let width = strings::wtf8_byte_sequence_length_with_invalid(b);
                    if width == 1 {
                        self.uescape(0xFFFD);
                        i += 1;
                        continue;
                    }
                    let take = (width as usize).min(s.len() - i);
                    let mut bytes = [0u8; 4];
                    bytes[..take].copy_from_slice(&s[i..i + take]);
                    let cp = strings::decode_wtf8_rune_t::<i32>(bytes, width, -1);
                    if cp < 0 {
                        self.uescape(0xFFFD);
                        i += 1;
                    } else {
                        self.codepoint(cp as u32);
                        i += take;
                    }
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
        mut f: impl FnMut(&mut Self, T) -> Result<(), SerializeError>,
    ) -> Result<(), SerializeError> {
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
                self.raw(b"{\"index\":");
                self.uint(idx as u64);
                self.key("path");
                self.str(rec.path.text);
                self.key("importKind");
                self.str(rec.kind.label());
                self.end();
            }
            None => self.null(),
        }
    }
}

// ─── statements ────────────────────────────────────────────────────────────
impl<'a> Writer<'a> {
    fn stmt(&mut self, s: &Stmt) -> Result<(), SerializeError> {
        if !self.stack.is_safe_to_recurse() {
            return Err(SerializeError::StackOverflow);
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
    ) -> Result<(), SerializeError> {
        self.arr(items, |w, s| w.stmt(s))
    }

    fn case(&mut self, c: &Case) -> Result<(), SerializeError> {
        self.raw(b"{\"loc\":");
        self.loc(c.loc);
        self.key("value");
        self.opt_expr(c.value)?;
        self.key("body");
        self.stmt_list(c.body.iter())?;
        self.end();
        Ok(())
    }

    fn catch(&mut self, c: &Catch) -> Result<(), SerializeError> {
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

    fn finally(&mut self, f: &Finally) -> Result<(), SerializeError> {
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

    fn enum_value(&mut self, ev: &EnumValue) -> Result<(), SerializeError> {
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
    fn expr(&mut self, e: &Expr) -> Result<(), SerializeError> {
        if !self.stack.is_safe_to_recurse() {
            return Err(SerializeError::StackOverflow);
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
    fn opt_expr(&mut self, e: Option<Expr>) -> Result<(), SerializeError> {
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
    ) -> Result<(), SerializeError> {
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

    fn template_part(&mut self, p: &E::TemplatePart) -> Result<(), SerializeError> {
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
    fn binding(&mut self, b: &Binding) -> Result<(), SerializeError> {
        if !self.stack.is_safe_to_recurse() {
            return Err(SerializeError::StackOverflow);
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

    fn array_binding(&mut self, ab: &ArrayBinding) -> Result<(), SerializeError> {
        self.raw(b"{\"binding\":");
        self.binding(&ab.binding)?;
        self.key("defaultValue");
        self.opt_expr(ab.default_value)?;
        self.end();
        Ok(())
    }

    fn b_property(&mut self, p: &ast::b::Property) -> Result<(), SerializeError> {
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
    fn g_decl(&mut self, d: &G::Decl) -> Result<(), SerializeError> {
        self.raw(b"{\"binding\":");
        self.binding(&d.binding)?;
        self.key("value");
        self.opt_expr(d.value)?;
        self.end();
        Ok(())
    }

    fn g_arg(&mut self, a: &G::Arg) -> Result<(), SerializeError> {
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

    fn g_fn_body(&mut self, b: &G::FnBody) -> Result<(), SerializeError> {
        self.raw(b"{\"loc\":");
        self.loc(b.loc);
        self.key("stmts");
        self.stmt_list(b.stmts.iter())?;
        self.end();
        Ok(())
    }

    fn g_fn(&mut self, f: &G::Fn) -> Result<(), SerializeError> {
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

    fn g_property(&mut self, p: &G::Property) -> Result<(), SerializeError> {
        self.raw(b"{\"propertyKind\":");
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

    fn g_class(&mut self, c: &G::Class) -> Result<(), SerializeError> {
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

// ─── raw tape format (LE, 4-aligned; see src/js/builtins/Transpiler.ts) ────

const TAPE_MAGIC: u32 = 0x4255_4E41; // "BUNA"
const TAPE_VERSION: u32 = 1;
const TAPE_HEADER_SIZE: usize = 24;

const TY_NULL: u8 = 0;
const TY_FALSE: u8 = 1;
const TY_TRUE: u8 = 2;
const TY_I32: u8 = 3;
const TY_F64: u8 = 4;
const TY_STR: u8 = 5;
const TY_NODE: u8 = 6;
const TY_ARRAY: u8 = 7;
const TY_STR16: u8 = 8;

/// One field/element payload; node/array offsets are absolute byte offsets.
#[derive(Clone, Copy)]
struct Val {
    ty: u8,
    lo: u32,
    hi: u32,
}

const V_NULL: Val = Val {
    ty: TY_NULL,
    lo: 0,
    hi: 0,
};

pub(crate) fn ast_to_tape(ast: &ast::Ast<'_>, buf: &mut Vec<u8>) -> Result<(), SerializeError> {
    buf.reserve(
        ast.approximate_newline_count
            .saturating_mul(96)
            .max(TAPE_HEADER_SIZE + 256),
    );
    buf.extend_from_slice(&[0u8; TAPE_HEADER_SIZE]);

    let mut w = TapeWriter::new(buf, ast.symbols.as_slice(), ast.import_records.as_slice());

    let root = w.write_root(ast)?;

    w.align4();
    for i in 0..w.key_names.len() {
        let name = w.key_names[i];
        let (off, len) = w.intern_str(name.as_bytes());
        w.buf.extend_from_slice(&off.to_le_bytes());
        w.buf.extend_from_slice(&len.to_le_bytes());
    }
    let key_table_len = w.key_names.len() as u32;

    let strings_offset = w.buf.len();
    let strings_len = w.strings.len();
    if w.overflow || strings_offset.saturating_add(strings_len) > TAPE_MAX_LEN {
        return Err(SerializeError::TapeTooLarge);
    }
    let strings_offset = strings_offset as u32;
    let strings_len = strings_len as u32;
    w.buf.extend_from_slice(&w.strings);

    let hdr = w.buf;
    hdr[0..4].copy_from_slice(&TAPE_MAGIC.to_le_bytes());
    hdr[4..8].copy_from_slice(&TAPE_VERSION.to_le_bytes());
    hdr[8..12].copy_from_slice(&root.to_le_bytes());
    hdr[12..16].copy_from_slice(&strings_offset.to_le_bytes());
    hdr[16..20].copy_from_slice(&strings_len.to_le_bytes());
    hdr[20..24].copy_from_slice(&key_table_len.to_le_bytes());
    Ok(())
}

struct TapeWriter<'a> {
    buf: &'a mut Vec<u8>,
    strings: Vec<u8>,
    string_index: bun_collections::HashMap<Box<[u8]>, (u32, u32)>,
    key_ids: bun_collections::HashMap<&'static str, u8>,
    key_names: Vec<&'static str>,
    symbols: &'a [Symbol],
    import_records: &'a [ImportRecord],
    stack: StackCheck,
    /// Sticky `TAPE_MAX_LEN` breach; rechecked at recursive entries and in `ast_to_tape`.
    overflow: bool,
}

impl<'a> TapeWriter<'a> {
    fn new(
        buf: &'a mut Vec<u8>,
        symbols: &'a [Symbol],
        import_records: &'a [ImportRecord],
    ) -> Self {
        let mut key_ids = bun_collections::HashMap::new();
        key_ids.insert("kind", 0u8);
        key_ids.insert("loc", 1u8);
        Self {
            buf,
            strings: Vec::new(),
            string_index: bun_collections::HashMap::new(),
            key_ids,
            key_names: vec!["kind", "loc"],
            symbols,
            import_records,
            stack: StackCheck::init(),
            overflow: false,
        }
    }

    #[inline]
    fn align4(&mut self) {
        while self.buf.len() & 3 != 0 {
            self.buf.push(0);
        }
    }

    fn key_id(&mut self, name: &'static str) -> u8 {
        if let Some(&id) = self.key_ids.get(name) {
            return id;
        }
        let id = self.key_names.len();
        assert!(
            id <= u8::MAX as usize,
            "unstable_parse tape: key table exceeds 255 entries"
        );
        let id = id as u8;
        self.key_ids.insert(name, id);
        self.key_names.push(name);
        id
    }

    fn intern_str(&mut self, s: &[u8]) -> (u32, u32) {
        if let Some(&v) = self.string_index.get(s) {
            return v;
        }
        let off = self.strings.len();
        if off.saturating_add(s.len()) > TAPE_MAX_LEN {
            self.overflow = true;
            return (0, 0);
        }
        self.strings.extend_from_slice(s);
        let v = (off as u32, s.len() as u32);
        self.string_index.insert(s.to_vec().into_boxed_slice(), v);
        v
    }

    /// Store raw UTF-16 LE code units; `to_utf8_alloc` would replace lone surrogates with U+FFFD.
    fn intern_str16(&mut self, s: &[u16]) -> (u32, u32) {
        let mut bytes = Vec::with_capacity(s.len() * 2);
        for &u in s {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        self.intern_str(&bytes)
    }

    #[inline]
    fn begin_node(&mut self) -> u32 {
        self.align4();
        let off = self.buf.len();
        if off > TAPE_MAX_LEN {
            self.overflow = true;
        }
        self.buf.extend_from_slice(&[0u8; 4]);
        off as u32
    }

    #[inline]
    fn end_node(&mut self, off: u32) -> u32 {
        let payload = (self.buf.len() as u32).wrapping_sub(off).wrapping_sub(4);
        debug_assert!(payload.is_multiple_of(12));
        let n = (payload / 12) as u16;
        self.buf[off as usize..off as usize + 2].copy_from_slice(&n.to_le_bytes());
        off
    }

    #[inline]
    fn push_field(&mut self, key_id: u8, ty: u8, lo: u32, hi: u32) {
        self.buf.push(key_id);
        self.buf.push(ty);
        self.buf.extend_from_slice(&[0u8; 2]);
        self.buf.extend_from_slice(&lo.to_le_bytes());
        self.buf.extend_from_slice(&hi.to_le_bytes());
    }

    #[inline]
    fn f_kind(&mut self, kind: &'static str) {
        let (lo, hi) = self.intern_str(kind.as_bytes());
        self.push_field(0, TY_STR, lo, hi);
    }

    #[inline]
    fn f_loc(&mut self, loc: Loc) {
        if loc.start < 0 {
            self.push_field(1, TY_NULL, 0, 0);
        } else {
            self.push_field(1, TY_I32, loc.start as u32, 0);
        }
    }

    #[inline]
    fn field(&mut self, name: &'static str, v: Val) {
        let k = self.key_id(name);
        self.push_field(k, v.ty, v.lo, v.hi);
    }

    #[inline]
    fn f_null(&mut self, name: &'static str) {
        self.field(name, V_NULL);
    }

    #[inline]
    fn f_bool(&mut self, name: &'static str, b: bool) {
        let k = self.key_id(name);
        self.push_field(k, if b { TY_TRUE } else { TY_FALSE }, 0, 0);
    }

    #[inline]
    fn f_i32(&mut self, name: &'static str, n: i32) {
        let k = self.key_id(name);
        self.push_field(k, TY_I32, n as u32, 0);
    }

    fn f_f64(&mut self, name: &'static str, n: f64) {
        let k = self.key_id(name);
        if !n.is_finite() {
            return self.push_field(k, TY_NULL, 0, 0);
        }
        let i = n as i32;
        if i as f64 == n {
            return self.push_field(k, TY_I32, i as u32, 0);
        }
        let b = n.to_bits();
        self.push_field(k, TY_F64, b as u32, (b >> 32) as u32);
    }

    #[inline]
    fn f_str(&mut self, name: &'static str, s: &[u8]) {
        let k = self.key_id(name);
        let (lo, hi) = self.intern_str(s);
        self.push_field(k, TY_STR, lo, hi);
    }

    #[inline]
    fn f_enum<T: Into<&'static str>>(&mut self, name: &'static str, v: T) {
        self.f_str(name, v.into().as_bytes());
    }

    #[inline]
    fn f_node(&mut self, name: &'static str, off: u32) {
        let k = self.key_id(name);
        self.push_field(k, TY_NODE, off, 0);
    }

    #[inline]
    fn f_array(&mut self, name: &'static str, arr: (u32, u32)) {
        let k = self.key_id(name);
        self.push_field(k, TY_ARRAY, arr.0, arr.1);
    }

    fn f_ref(&mut self, name: &'static str, r: Ref) {
        if !r.is_valid() {
            return self.f_null(name);
        }
        match self.symbols.get(r.inner_index() as usize) {
            Some(sym) => self.f_str(name, sym.original_name.slice()),
            None => self.f_null(name),
        }
    }

    fn f_optional_chain(&mut self, name: &'static str, oc: Option<OptionalChain>) {
        match oc {
            Some(c) => self.f_enum(name, c),
            None => self.f_null(name),
        }
    }

    fn f_loc_at(&mut self, name: &'static str, loc: Loc) {
        if loc.start < 0 {
            self.f_null(name);
        } else {
            self.f_i32(name, loc.start);
        }
    }

    /// Write an array block of already-encoded payloads.
    fn write_array(&mut self, items: &[Val]) -> (u32, u32) {
        self.align4();
        let off = self.buf.len();
        if off > TAPE_MAX_LEN || items.len() > TAPE_MAX_LEN {
            self.overflow = true;
        }
        let off = off as u32;
        let count = items.len() as u32;
        self.buf.extend_from_slice(&count.to_le_bytes());
        for v in items {
            self.buf.push(v.ty);
            self.buf.extend_from_slice(&[0u8; 3]);
            self.buf.extend_from_slice(&v.lo.to_le_bytes());
            self.buf.extend_from_slice(&v.hi.to_le_bytes());
        }
        (off, count)
    }

    fn write_node_array<T>(
        &mut self,
        items: impl Iterator<Item = T>,
        mut f: impl FnMut(&mut Self, T) -> Result<u32, SerializeError>,
    ) -> Result<(u32, u32), SerializeError> {
        let mut offs: Vec<Val> = Vec::new();
        for it in items {
            let o = f(self, it)?;
            offs.push(Val {
                ty: TY_NODE,
                lo: o,
                hi: 0,
            });
        }
        Ok(self.write_array(&offs))
    }

    fn v_str(&mut self, s: &[u8]) -> Val {
        let (lo, hi) = self.intern_str(s);
        Val { ty: TY_STR, lo, hi }
    }

    fn v_e_string(&mut self, s: &E::EString) -> Val {
        if s.next.is_some() && s.is_utf8() {
            let mut bytes: Vec<u8> = Vec::with_capacity(s.rope_len as usize);
            bytes.extend_from_slice(s.slice8());
            let mut next = s.next;
            while let Some(part) = next {
                let part = part.get();
                bytes.extend_from_slice(&part.data);
                next = part.next;
            }
            return self.v_str(&bytes);
        }
        if s.is_utf16 {
            let (lo, hi) = self.intern_str16(s.slice16());
            Val {
                ty: TY_STR16,
                lo,
                hi,
            }
        } else {
            self.v_str(s.slice8())
        }
    }

    fn v_template_contents(&mut self, tc: &E::TemplateContents) -> Val {
        match tc {
            E::TemplateContents::Cooked(s) => self.v_e_string(s),
            E::TemplateContents::Raw(s) => self.v_str(s.slice()),
        }
    }

    fn loc_ref(&mut self, lr: ast::LocRef) -> u32 {
        let off = self.begin_node();
        self.f_loc(lr.loc);
        self.f_ref("name", lr.ref_);
        self.end_node(off)
    }

    fn opt_loc_ref(&mut self, lr: Option<ast::LocRef>) -> Val {
        match lr {
            Some(lr) => {
                let o = self.loc_ref(lr);
                Val {
                    ty: TY_NODE,
                    lo: o,
                    hi: 0,
                }
            }
            None => V_NULL,
        }
    }

    fn import_record_idx(&mut self, idx: u32) -> Val {
        match self.import_records.get(idx as usize) {
            Some(rec) => {
                let path = self.v_str(rec.path.text);
                let kind = self.v_str(rec.kind.label());
                let off = self.begin_node();
                self.f_i32("index", idx as i32);
                self.field("path", path);
                self.field("importKind", kind);
                self.end_node(off);
                Val {
                    ty: TY_NODE,
                    lo: off,
                    hi: 0,
                }
            }
            None => V_NULL,
        }
    }

    fn write_root(&mut self, ast: &ast::Ast<'_>) -> Result<u32, SerializeError> {
        let hashbang = if ast.hashbang.slice().is_empty() {
            V_NULL
        } else {
            self.v_str(ast.hashbang.slice())
        };
        let directive = match &ast.directive {
            Some(d) => self.v_str(d.slice()),
            None => V_NULL,
        };

        let mut recs: Vec<Val> = Vec::with_capacity(self.import_records.len());
        for rec in self.import_records.iter() {
            let path = self.v_str(rec.path.text);
            let kind = self.v_str(rec.kind.label());
            let off = self.begin_node();
            self.field("path", path);
            self.field("kind", kind);
            self.end_node(off);
            recs.push(Val {
                ty: TY_NODE,
                lo: off,
                hi: 0,
            });
        }
        let recs_arr = self.write_array(&recs);

        let mut syms: Vec<Val> = Vec::with_capacity(self.symbols.len());
        for sym in self.symbols.iter() {
            let name = self.v_str(sym.original_name.slice());
            let kind: &'static str = sym.kind.into();
            let kind = self.v_str(kind.as_bytes());
            let off = self.begin_node();
            self.field("name", name);
            self.field("kind", kind);
            self.end_node(off);
            syms.push(Val {
                ty: TY_NODE,
                lo: off,
                hi: 0,
            });
        }
        let syms_arr = self.write_array(&syms);

        let mut stmts: Vec<Val> = Vec::new();
        for part in ast.parts.as_slice().iter() {
            for s in part.stmts.iter() {
                let o = self.stmt(s)?;
                stmts.push(Val {
                    ty: TY_NODE,
                    lo: o,
                    hi: 0,
                });
            }
        }
        let stmts_arr = self.write_array(&stmts);

        let off = self.begin_node();
        self.f_kind("ast");
        self.field("hashbang", hashbang);
        self.field("directive", directive);
        self.f_enum("exportsKind", ast.exports_kind);
        self.f_f64(
            "approximateNewlineCount",
            ast.approximate_newline_count as f64,
        );
        self.f_array("importRecords", recs_arr);
        self.f_array("symbols", syms_arr);
        self.f_array("stmts", stmts_arr);
        Ok(self.end_node(off))
    }
}

// ─── tape: statements ──────────────────────────────────────────────────────
impl<'a> TapeWriter<'a> {
    fn stmt(&mut self, s: &Stmt) -> Result<u32, SerializeError> {
        if !self.stack.is_safe_to_recurse() {
            return Err(SerializeError::StackOverflow);
        }
        if self.overflow {
            return Err(SerializeError::TapeTooLarge);
        }
        let kind: &'static str = s.data.tag().into();
        macro_rules! node {
            ($($body:tt)*) => {{
                let off = self.begin_node();
                self.f_kind(kind);
                self.f_loc(s.loc);
                $($body)*
                Ok(self.end_node(off))
            }};
        }
        match &s.data {
            StmtData::SBlock(v) => {
                let stmts = self.stmt_list(v.stmts.iter())?;
                node! {
                    self.f_array("stmts", stmts);
                    self.f_loc_at("closeBraceLoc", v.close_brace_loc);
                }
            }
            StmtData::SBreak(v) => {
                let label = self.opt_loc_ref(v.label);
                node! { self.field("label", label); }
            }
            StmtData::SContinue(v) => {
                let label = self.opt_loc_ref(v.label);
                node! { self.field("label", label); }
            }
            StmtData::SComment(v) => {
                node! { self.f_str("text", v.text.slice()); }
            }
            StmtData::SDirective(v) => {
                node! { self.f_str("value", v.value.slice()); }
            }
            StmtData::SDebugger(_) | StmtData::SEmpty(_) | StmtData::STypeScript(_) => {
                node! {}
            }
            StmtData::SDoWhile(v) => {
                let body = self.stmt(&v.body)?;
                let test = self.expr(&v.test)?;
                node! {
                    self.f_node("body", body);
                    self.f_node("test", test);
                }
            }
            StmtData::SWhile(v) => {
                let test = self.expr(&v.test)?;
                let body = self.stmt(&v.body)?;
                node! {
                    self.f_node("test", test);
                    self.f_node("body", body);
                }
            }
            StmtData::SWith(v) => {
                let value = self.expr(&v.value)?;
                let body = self.stmt(&v.body)?;
                node! {
                    self.f_node("value", value);
                    self.f_node("body", body);
                }
            }
            StmtData::SExpr(v) => {
                let value = self.expr(&v.value)?;
                node! { self.f_node("value", value); }
            }
            StmtData::SIf(v) => {
                let test = self.expr(&v.test)?;
                let yes = self.stmt(&v.yes)?;
                let no = self.opt_stmt(v.no)?;
                node! {
                    self.f_node("test", test);
                    self.f_node("yes", yes);
                    self.field("no", no);
                }
            }
            StmtData::SFor(v) => {
                let init = self.opt_stmt(v.init)?;
                let test = self.opt_expr(v.test)?;
                let update = self.opt_expr(v.update)?;
                let body = self.stmt(&v.body)?;
                node! {
                    self.field("init", init);
                    self.field("test", test);
                    self.field("update", update);
                    self.f_node("body", body);
                }
            }
            StmtData::SForIn(v) => {
                let init = self.stmt(&v.init)?;
                let value = self.expr(&v.value)?;
                let body = self.stmt(&v.body)?;
                node! {
                    self.f_node("init", init);
                    self.f_node("value", value);
                    self.f_node("body", body);
                }
            }
            StmtData::SForOf(v) => {
                let init = self.stmt(&v.init)?;
                let value = self.expr(&v.value)?;
                let body = self.stmt(&v.body)?;
                node! {
                    self.f_bool("isAwait", v.is_await);
                    self.f_node("init", init);
                    self.f_node("value", value);
                    self.f_node("body", body);
                }
            }
            StmtData::SReturn(v) => {
                let value = self.opt_expr(v.value)?;
                node! { self.field("value", value); }
            }
            StmtData::SThrow(v) => {
                let value = self.expr(&v.value)?;
                node! { self.f_node("value", value); }
            }
            StmtData::SLabel(v) => {
                let name = self.loc_ref(v.name);
                let stmt = self.stmt(&v.stmt)?;
                node! {
                    self.f_node("name", name);
                    self.f_node("stmt", stmt);
                }
            }
            StmtData::SSwitch(v) => {
                let test = self.expr(&v.test)?;
                let cases = self.write_node_array(v.cases.iter(), |w, c| w.case(c))?;
                node! {
                    self.f_node("test", test);
                    self.f_array("cases", cases);
                }
            }
            StmtData::STry(v) => {
                let body = self.stmt_list(v.body.iter())?;
                let catch = match &v.catch {
                    Some(c) => {
                        let o = self.catch(c)?;
                        Val {
                            ty: TY_NODE,
                            lo: o,
                            hi: 0,
                        }
                    }
                    None => V_NULL,
                };
                let finally = match &v.finally {
                    Some(f) => {
                        let o = self.finally(f)?;
                        Val {
                            ty: TY_NODE,
                            lo: o,
                            hi: 0,
                        }
                    }
                    None => V_NULL,
                };
                node! {
                    self.f_array("body", body);
                    self.field("catch", catch);
                    self.field("finally", finally);
                }
            }
            StmtData::SClass(v) => {
                let class = self.g_class(&v.class)?;
                node! {
                    self.f_node("class", class);
                    self.f_bool("isExport", v.is_export);
                }
            }
            StmtData::SFunction(v) => {
                let func = self.g_fn(&v.func)?;
                node! { self.f_node("func", func); }
            }
            StmtData::SLocal(v) => {
                let decls = self.write_node_array(v.decls.slice().iter(), |w, d| w.g_decl(d))?;
                node! {
                    self.f_enum("declKind", v.kind);
                    self.f_bool("isExport", v.is_export);
                    self.f_array("decls", decls);
                }
            }
            StmtData::SEnum(v) => {
                let name = self.loc_ref(v.name);
                let values = self.write_node_array(v.values.iter(), |w, ev| w.enum_value(ev))?;
                node! {
                    self.f_node("name", name);
                    self.f_bool("isExport", v.is_export);
                    self.f_array("values", values);
                }
            }
            StmtData::SNamespace(v) => {
                let name = self.loc_ref(v.name);
                let stmts = self.stmt_list(v.stmts.iter())?;
                node! {
                    self.f_node("name", name);
                    self.f_bool("isExport", v.is_export);
                    self.f_array("stmts", stmts);
                }
            }
            StmtData::SImport(v) => {
                let items = self.write_node_array(v.items.iter(), |w, c| Ok(w.clause_item(c)))?;
                let default_name = self.opt_loc_ref(v.default_name);
                let rec = self.import_record_idx(v.import_record_index);
                node! {
                    self.f_ref("namespace", v.namespace_ref);
                    self.field("defaultName", default_name);
                    self.f_array("items", items);
                    self.f_loc_at("starNameLoc", v.star_name_loc);
                    self.f_bool("phaseDefer", v.phase_defer);
                    self.field("importRecord", rec);
                }
            }
            StmtData::SExportClause(v) => {
                let items = self.write_node_array(v.items.iter(), |w, c| Ok(w.clause_item(c)))?;
                node! { self.f_array("items", items); }
            }
            StmtData::SExportFrom(v) => {
                let items = self.write_node_array(v.items.iter(), |w, c| Ok(w.clause_item(c)))?;
                let rec = self.import_record_idx(v.import_record_index);
                node! {
                    self.f_array("items", items);
                    self.f_ref("namespace", v.namespace_ref);
                    self.field("importRecord", rec);
                }
            }
            StmtData::SExportStar(v) => {
                let alias = match &v.alias {
                    Some(a) => {
                        let off = self.begin_node();
                        self.f_loc(a.loc);
                        self.f_str("name", a.original_name.slice());
                        self.end_node(off);
                        Val {
                            ty: TY_NODE,
                            lo: off,
                            hi: 0,
                        }
                    }
                    None => V_NULL,
                };
                let rec = self.import_record_idx(v.import_record_index);
                node! {
                    self.f_ref("namespace", v.namespace_ref);
                    self.field("alias", alias);
                    self.field("importRecord", rec);
                }
            }
            StmtData::SExportEquals(v) => {
                let value = self.expr(&v.value)?;
                node! { self.f_node("value", value); }
            }
            StmtData::SExportDefault(v) => {
                let name = self.loc_ref(v.default_name);
                let value = match &v.value {
                    StmtOrExpr::Stmt(s) => self.stmt(s)?,
                    StmtOrExpr::Expr(e) => self.expr(e)?,
                };
                node! {
                    self.f_node("defaultName", name);
                    self.f_node("value", value);
                }
            }
            StmtData::SLazyExport(v) => {
                let value = self.expr(&Expr {
                    data: **v,
                    loc: s.loc,
                })?;
                node! { self.f_node("value", value); }
            }
        }
    }

    #[inline]
    fn stmt_list<'s>(
        &mut self,
        items: impl Iterator<Item = &'s Stmt>,
    ) -> Result<(u32, u32), SerializeError> {
        self.write_node_array(items, |w, s| w.stmt(s))
    }

    fn opt_stmt(&mut self, s: Option<Stmt>) -> Result<Val, SerializeError> {
        match s {
            Some(s) => {
                let o = self.stmt(&s)?;
                Ok(Val {
                    ty: TY_NODE,
                    lo: o,
                    hi: 0,
                })
            }
            None => Ok(V_NULL),
        }
    }

    fn case(&mut self, c: &Case) -> Result<u32, SerializeError> {
        let value = self.opt_expr(c.value)?;
        let body = self.stmt_list(c.body.iter())?;
        let off = self.begin_node();
        self.f_loc(c.loc);
        self.field("value", value);
        self.f_array("body", body);
        Ok(self.end_node(off))
    }

    fn catch(&mut self, c: &Catch) -> Result<u32, SerializeError> {
        let binding = match c.binding {
            Some(b) => {
                let o = self.binding(&b)?;
                Val {
                    ty: TY_NODE,
                    lo: o,
                    hi: 0,
                }
            }
            None => V_NULL,
        };
        let body = self.stmt_list(c.body.iter())?;
        let off = self.begin_node();
        self.f_loc(c.loc);
        self.field("binding", binding);
        self.f_array("body", body);
        Ok(self.end_node(off))
    }

    fn finally(&mut self, f: &Finally) -> Result<u32, SerializeError> {
        let stmts = self.stmt_list(f.stmts.iter())?;
        let off = self.begin_node();
        self.f_loc(f.loc);
        self.f_array("stmts", stmts);
        Ok(self.end_node(off))
    }

    fn clause_item(&mut self, c: &ClauseItem) -> u32 {
        let name = self.loc_ref(c.name);
        let off = self.begin_node();
        self.f_str("alias", c.alias.slice());
        self.f_loc_at("aliasLoc", c.alias_loc);
        self.f_node("name", name);
        self.f_str("originalName", c.original_name.slice());
        self.end_node(off)
    }

    fn enum_value(&mut self, ev: &EnumValue) -> Result<u32, SerializeError> {
        let value = self.opt_expr(ev.value)?;
        let off = self.begin_node();
        self.f_loc(ev.loc);
        self.f_str("name", ev.name.slice());
        self.field("value", value);
        Ok(self.end_node(off))
    }
}

// ─── tape: expressions ─────────────────────────────────────────────────────
impl<'a> TapeWriter<'a> {
    fn expr(&mut self, e: &Expr) -> Result<u32, SerializeError> {
        if !self.stack.is_safe_to_recurse() {
            return Err(SerializeError::StackOverflow);
        }
        if self.overflow {
            return Err(SerializeError::TapeTooLarge);
        }
        let kind: &'static str = e.data.tag().into();
        macro_rules! node {
            ($($body:tt)*) => {{
                let off = self.begin_node();
                self.f_kind(kind);
                self.f_loc(e.loc);
                $($body)*
                Ok(self.end_node(off))
            }};
        }
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
            | ExprData::ERequireMain => node! {},
            ExprData::EBoolean(v) | ExprData::EBranchBoolean(v) => {
                node! { self.f_bool("value", v.value); }
            }
            ExprData::ENumber(v) => {
                node! { self.f_f64("value", v.value()); }
            }
            ExprData::EBigInt(v) => {
                node! { self.f_str("value", v.value.slice()); }
            }
            ExprData::EString(v) => {
                let val = self.v_e_string(v);
                node! { self.field("value", val); }
            }
            ExprData::EIdentifier(v) => {
                node! { self.f_ref("name", v.ref_); }
            }
            ExprData::EImportIdentifier(v) => {
                node! {
                    self.f_ref("name", v.ref_);
                    self.f_bool("wasOriginallyIdentifier", v.was_originally_identifier());
                }
            }
            ExprData::EPrivateIdentifier(v) => {
                node! { self.f_ref("name", v.ref_); }
            }
            ExprData::ECommonjsExportIdentifier(v) => {
                node! { self.f_ref("name", v.ref_); }
            }
            ExprData::ENameOfSymbol(v) => {
                node! { self.f_ref("name", v.ref_); }
            }
            ExprData::EUnary(v) => {
                let value = self.expr(&v.value)?;
                node! {
                    self.f_enum("op", v.op);
                    self.f_node("value", value);
                }
            }
            ExprData::EBinary(v) => {
                let left = self.expr(&v.left)?;
                let right = self.expr(&v.right)?;
                node! {
                    self.f_enum("op", v.op);
                    self.f_node("left", left);
                    self.f_node("right", right);
                }
            }
            ExprData::EArray(v) => {
                let items = self.expr_list(v.items.slice().iter())?;
                node! {
                    self.f_array("items", items);
                    self.f_bool("isParenthesized", v.is_parenthesized);
                }
            }
            ExprData::EObject(v) => {
                let props =
                    self.write_node_array(v.properties.slice().iter(), |w, p| w.g_property(p))?;
                node! {
                    self.f_array("properties", props);
                    self.f_bool("isParenthesized", v.is_parenthesized);
                }
            }
            ExprData::ESpread(v) => {
                let value = self.expr(&v.value)?;
                node! { self.f_node("value", value); }
            }
            ExprData::EAwait(v) => {
                let value = self.expr(&v.value)?;
                node! { self.f_node("value", value); }
            }
            ExprData::EYield(v) => {
                let value = self.opt_expr(v.value)?;
                node! {
                    self.field("value", value);
                    self.f_bool("isStar", v.is_star);
                }
            }
            ExprData::EIf(v) => {
                let test = self.expr(&v.test)?;
                let yes = self.expr(&v.yes)?;
                let no = self.expr(&v.no)?;
                node! {
                    self.f_node("test", test);
                    self.f_node("yes", yes);
                    self.f_node("no", no);
                }
            }
            ExprData::ENew(v) => {
                let target = self.expr(&v.target)?;
                let args = self.expr_list(v.args.slice().iter())?;
                node! {
                    self.f_node("target", target);
                    self.f_array("args", args);
                }
            }
            ExprData::ECall(v) => {
                let target = self.expr(&v.target)?;
                let args = self.expr_list(v.args.slice().iter())?;
                node! {
                    self.f_node("target", target);
                    self.f_array("args", args);
                    self.f_optional_chain("optionalChain", v.optional_chain);
                    self.f_bool("isDirectEval", v.is_direct_eval);
                }
            }
            ExprData::EDot(v) => {
                let target = self.expr(&v.target)?;
                node! {
                    self.f_node("target", target);
                    self.f_str("name", v.name.slice());
                    self.f_loc_at("nameLoc", v.name_loc);
                    self.f_optional_chain("optionalChain", v.optional_chain);
                }
            }
            ExprData::EIndex(v) => {
                let target = self.expr(&v.target)?;
                let index = self.expr(&v.index)?;
                node! {
                    self.f_node("target", target);
                    self.f_node("index", index);
                    self.f_optional_chain("optionalChain", v.optional_chain);
                }
            }
            ExprData::EArrow(v) => {
                let args = self.write_node_array(v.args.iter(), |w, a| w.g_arg(a))?;
                let body = self.g_fn_body(&v.body)?;
                node! {
                    self.f_array("args", args);
                    self.f_node("body", body);
                    self.f_bool("isAsync", v.is_async);
                    self.f_bool("hasRestArg", v.has_rest_arg);
                    self.f_bool("preferExpr", v.prefer_expr);
                }
            }
            ExprData::EFunction(v) => {
                let func = self.g_fn(&v.func)?;
                node! { self.f_node("func", func); }
            }
            ExprData::EClass(v) => {
                let class = self.g_class(v)?;
                node! { self.f_node("class", class); }
            }
            ExprData::EJsxElement(v) => {
                let tag = self.opt_expr(v.tag)?;
                let props =
                    self.write_node_array(v.properties.slice().iter(), |w, p| w.g_property(p))?;
                let children = self.expr_list(v.children.slice().iter())?;
                node! {
                    self.field("tag", tag);
                    self.f_array("properties", props);
                    self.f_array("children", children);
                }
            }
            ExprData::ETemplate(v) => {
                let tag = self.opt_expr(v.tag)?;
                let head = self.v_template_contents(&v.head);
                let parts = self.write_node_array(v.parts().iter(), |w, p| w.template_part(p))?;
                node! {
                    self.field("tag", tag);
                    self.field("head", head);
                    self.f_array("parts", parts);
                }
            }
            ExprData::ERegExp(v) => {
                node! {
                    self.f_str("pattern", v.pattern());
                    self.f_str("flags", v.flags());
                }
            }
            ExprData::EImport(v) => {
                let expr = self.expr(&v.expr)?;
                let options = if matches!(v.options.data, ExprData::EMissing(_)) {
                    V_NULL
                } else {
                    let o = self.expr(&v.options)?;
                    Val {
                        ty: TY_NODE,
                        lo: o,
                        hi: 0,
                    }
                };
                let rec = if v.is_import_record_null() {
                    V_NULL
                } else {
                    self.import_record_idx(v.import_record_index)
                };
                node! {
                    self.f_node("expr", expr);
                    self.field("options", options);
                    self.field("importRecord", rec);
                }
            }
            ExprData::ERequireString(v) => {
                let rec = self.import_record_idx(v.import_record_index);
                node! { self.field("importRecord", rec); }
            }
            ExprData::ERequireResolveString(v) => {
                let rec = self.import_record_idx(v.import_record_index);
                node! { self.field("importRecord", rec); }
            }
            ExprData::EImportMetaMain(v) => {
                node! { self.f_bool("inverted", v.inverted); }
            }
            ExprData::ESpecial(v) => {
                let name: &'static [u8] = match v {
                    E::Special::ModuleExports => b"module_exports",
                    E::Special::HotEnabled => b"hot_enabled",
                    E::Special::HotDisabled => b"hot_disabled",
                    E::Special::HotData => b"hot_data",
                    E::Special::HotAccept => b"hot_accept",
                    E::Special::HotAcceptVisited => b"hot_accept_visited",
                    E::Special::ResolvedSpecifierString(_) => b"resolved_specifier_string",
                };
                node! { self.f_str("special", name); }
            }
            ExprData::EInlinedEnum(v) => {
                let value = self.expr(&v.value)?;
                node! {
                    self.f_node("value", value);
                    self.f_str("comment", v.comment.slice());
                }
            }
            ExprData::EObjectJSON(_) | ExprData::EArrayJSON(_) => node! {},
        }
    }

    #[inline]
    fn opt_expr(&mut self, e: Option<Expr>) -> Result<Val, SerializeError> {
        match e {
            Some(e) => {
                let o = self.expr(&e)?;
                Ok(Val {
                    ty: TY_NODE,
                    lo: o,
                    hi: 0,
                })
            }
            None => Ok(V_NULL),
        }
    }

    #[inline]
    fn expr_list<'e>(
        &mut self,
        items: impl Iterator<Item = &'e Expr>,
    ) -> Result<(u32, u32), SerializeError> {
        self.write_node_array(items, |w, e| w.expr(e))
    }

    fn template_part(&mut self, p: &E::TemplatePart) -> Result<u32, SerializeError> {
        let value = self.expr(&p.value)?;
        let tail = self.v_template_contents(&p.tail);
        let off = self.begin_node();
        self.f_node("value", value);
        self.f_loc_at("tailLoc", p.tail_loc);
        self.field("tail", tail);
        Ok(self.end_node(off))
    }
}

// ─── tape: bindings ────────────────────────────────────────────────────────
impl<'a> TapeWriter<'a> {
    fn binding(&mut self, b: &Binding) -> Result<u32, SerializeError> {
        if !self.stack.is_safe_to_recurse() {
            return Err(SerializeError::StackOverflow);
        }
        if self.overflow {
            return Err(SerializeError::TapeTooLarge);
        }
        let kind: &'static str = b.data.tag().into();
        macro_rules! node {
            ($($body:tt)*) => {{
                let off = self.begin_node();
                self.f_kind(kind);
                self.f_loc(b.loc);
                $($body)*
                Ok(self.end_node(off))
            }};
        }
        match &b.data {
            BData::BMissing(_) => node! {},
            BData::BIdentifier(v) => {
                node! { self.f_ref("name", v.r#ref); }
            }
            BData::BArray(v) => {
                let items = self.write_node_array(v.items().iter(), |w, it| w.array_binding(it))?;
                node! {
                    self.f_array("items", items);
                    self.f_bool("hasSpread", v.has_spread);
                }
            }
            BData::BObject(v) => {
                let props = self.write_node_array(v.properties().iter(), |w, p| w.b_property(p))?;
                node! { self.f_array("properties", props); }
            }
        }
    }

    fn array_binding(&mut self, ab: &ArrayBinding) -> Result<u32, SerializeError> {
        let binding = self.binding(&ab.binding)?;
        let default_value = self.opt_expr(ab.default_value)?;
        let off = self.begin_node();
        self.f_node("binding", binding);
        self.field("defaultValue", default_value);
        Ok(self.end_node(off))
    }

    fn b_property(&mut self, p: &ast::b::Property) -> Result<u32, SerializeError> {
        let key = self.expr(&p.key)?;
        let value = self.binding(&p.value)?;
        let default_value = match &p.default_value {
            Some(e) => {
                let o = self.expr(e)?;
                Val {
                    ty: TY_NODE,
                    lo: o,
                    hi: 0,
                }
            }
            None => V_NULL,
        };
        let off = self.begin_node();
        self.f_node("key", key);
        self.f_node("value", value);
        self.field("defaultValue", default_value);
        self.f_bool("isSpread", p.flags.contains(flags::Property::IsSpread));
        self.f_bool("isComputed", p.flags.contains(flags::Property::IsComputed));
        Ok(self.end_node(off))
    }
}

// ─── tape: shared G.* nodes ────────────────────────────────────────────────
impl<'a> TapeWriter<'a> {
    fn g_decl(&mut self, d: &G::Decl) -> Result<u32, SerializeError> {
        let binding = self.binding(&d.binding)?;
        let value = self.opt_expr(d.value)?;
        let off = self.begin_node();
        self.f_node("binding", binding);
        self.field("value", value);
        Ok(self.end_node(off))
    }

    fn g_arg(&mut self, a: &G::Arg) -> Result<u32, SerializeError> {
        let binding = self.binding(&a.binding)?;
        let default = self.opt_expr(a.default)?;
        let ts_decorators = self.expr_list(a.ts_decorators.slice().iter())?;
        let off = self.begin_node();
        self.f_node("binding", binding);
        self.field("default", default);
        self.f_array("tsDecorators", ts_decorators);
        self.f_bool("isTypescriptCtorField", a.is_typescript_ctor_field);
        Ok(self.end_node(off))
    }

    fn g_fn_body(&mut self, b: &G::FnBody) -> Result<u32, SerializeError> {
        let stmts = self.stmt_list(b.stmts.iter())?;
        let off = self.begin_node();
        self.f_loc(b.loc);
        self.f_array("stmts", stmts);
        Ok(self.end_node(off))
    }

    fn g_fn(&mut self, f: &G::Fn) -> Result<u32, SerializeError> {
        let name = self.opt_loc_ref(f.name);
        let args = self.write_node_array(f.args.iter(), |w, a| w.g_arg(a))?;
        let body = self.g_fn_body(&f.body)?;
        let off = self.begin_node();
        self.field("name", name);
        self.f_array("args", args);
        self.f_node("body", body);
        self.f_bool("isAsync", f.flags.contains(flags::Function::IsAsync));
        self.f_bool(
            "isGenerator",
            f.flags.contains(flags::Function::IsGenerator),
        );
        self.f_bool("hasRestArg", f.flags.contains(flags::Function::HasRestArg));
        self.f_bool("isExport", f.flags.contains(flags::Function::IsExport));
        Ok(self.end_node(off))
    }

    fn g_property(&mut self, p: &G::Property) -> Result<u32, SerializeError> {
        let key = self.opt_expr(p.key)?;
        let value = self.opt_expr(p.value)?;
        let initializer = self.opt_expr(p.initializer)?;
        let ts_decorators = self.expr_list(p.ts_decorators.slice().iter())?;
        let csb = match p.class_static_block_ref() {
            Some(csb) => {
                let stmts = self.stmt_list(csb.stmts.slice().iter())?;
                let off = self.begin_node();
                self.f_loc(csb.loc);
                self.f_array("stmts", stmts);
                self.end_node(off);
                Val {
                    ty: TY_NODE,
                    lo: off,
                    hi: 0,
                }
            }
            None => V_NULL,
        };
        let off = self.begin_node();
        self.f_enum("propertyKind", p.kind);
        self.field("key", key);
        self.field("value", value);
        self.field("initializer", initializer);
        self.f_array("tsDecorators", ts_decorators);
        self.f_bool("isComputed", p.flags.contains(flags::Property::IsComputed));
        self.f_bool("isMethod", p.flags.contains(flags::Property::IsMethod));
        self.f_bool("isStatic", p.flags.contains(flags::Property::IsStatic));
        self.f_bool("isSpread", p.flags.contains(flags::Property::IsSpread));
        self.f_bool(
            "wasShorthand",
            p.flags.contains(flags::Property::WasShorthand),
        );
        self.field("classStaticBlock", csb);
        Ok(self.end_node(off))
    }

    fn g_class(&mut self, c: &G::Class) -> Result<u32, SerializeError> {
        let name = self.opt_loc_ref(c.class_name);
        let extends = self.opt_expr(c.extends)?;
        let ts_decorators = self.expr_list(c.ts_decorators.slice().iter())?;
        let properties = self.write_node_array(c.properties.iter(), |w, p| w.g_property(p))?;
        let off = self.begin_node();
        self.field("name", name);
        self.field("extends", extends);
        self.f_array("tsDecorators", ts_decorators);
        self.f_array("properties", properties);
        self.f_bool("hasDecorators", c.has_decorators);
        Ok(self.end_node(off))
    }
}
