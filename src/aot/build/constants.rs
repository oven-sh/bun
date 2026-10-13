//! What the bundler replaces by a constant: `--define`, `feature()` of `bun:bundle`. Conditions on these are folded, so that the code
//! a build leaves out is not translated either.

use super::{FileBuild, Fx};
use crate::id::V;
use crate::ir::Op;
use bun_sema::atom::Atom;
use bun_sema::bind::{Decl, SymFlags};
use bun_sema::check::Primitive;
use bun_sema::hir::{self, ExprId, ExprKind, StmtId};
use bun_sema::program::FileId;

#[derive(Clone, PartialEq, Debug)]
pub(crate) enum Constant {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u8>),
    /// A literal: each place it is put in makes an object of its own.
    Object(Vec<(Vec<u8>, Constant)>),
    Array(Vec<Constant>),
}

/// Reads the text of a define: JSON, and what else a primitive may be written as.
struct Reader<'a>(&'a [u8]);

impl Reader<'_> {
    fn skip_space(&mut self) {
        self.0 = self.0.trim_ascii_start();
    }

    fn take(&mut self, byte: u8) -> bool {
        self.skip_space();
        let found = self.0.first() == Some(&byte);
        if found {
            self.0 = &self.0[1..];
        }
        found
    }

    fn code_unit(&mut self) -> Option<u32> {
        let digits = std::str::from_utf8(self.0.get(..4)?).ok()?;
        self.0 = &self.0[4..];
        u32::from_str_radix(digits, 16).ok()
    }

    fn string(&mut self) -> Option<Vec<u8>> {
        self.skip_space();
        let (&quote, rest) = self.0.split_first()?;
        if quote != b'"' && quote != b'\'' {
            return None;
        }
        self.0 = rest;
        let mut value = Vec::new();
        loop {
            let (&byte, rest) = self.0.split_first()?;
            self.0 = rest;
            if byte == quote {
                return std::str::from_utf8(&value).is_ok().then_some(value);
            }
            if byte != b'\\' {
                value.push(byte);
                continue;
            }
            let (&escaped, rest) = self.0.split_first()?;
            self.0 = rest;
            match escaped {
                b'n' => value.push(b'\n'),
                b't' => value.push(b'\t'),
                b'r' => value.push(b'\r'),
                b'b' => value.push(8),
                b'f' => value.push(12),
                b'"' | b'\'' | b'\\' | b'/' => value.push(escaped),
                b'u' => {
                    let mut code = self.code_unit()?;
                    if (0xD800..0xDC00).contains(&code) && self.0.starts_with(b"\\u") {
                        self.0 = &self.0[2..];
                        let low = self.code_unit()?;
                        code = 0x10000 + ((code - 0xD800) << 10) + low.checked_sub(0xDC00)?;
                    }
                    value.extend_from_slice(char::from_u32(code)?.encode_utf8(&mut [0; 4]).as_bytes());
                }
                _ => return None,
            }
        }
    }

    fn value(&mut self) -> Option<Constant> {
        self.skip_space();
        match *self.0.first()? {
            b'"' | b'\'' => self.string().map(Constant::String),
            b'{' => {
                self.0 = &self.0[1..];
                let mut members = Vec::new();
                if self.take(b'}') {
                    return Some(Constant::Object(members));
                }
                loop {
                    let name = self.string()?;
                    if !self.take(b':') {
                        return None;
                    }
                    members.push((name, self.value()?));
                    if self.take(b'}') {
                        return Some(Constant::Object(members));
                    }
                    if !self.take(b',') {
                        return None;
                    }
                }
            }
            b'[' => {
                self.0 = &self.0[1..];
                let mut elements = Vec::new();
                if self.take(b']') {
                    return Some(Constant::Array(elements));
                }
                loop {
                    elements.push(self.value()?);
                    if self.take(b']') {
                        return Some(Constant::Array(elements));
                    }
                    if !self.take(b',') {
                        return None;
                    }
                }
            }
            _ => {
                let end = self.0.iter().position(|byte| matches!(byte, b',' | b'}' | b']') || byte.is_ascii_whitespace()).unwrap_or(self.0.len());
                let (word, rest) = self.0.split_at(end);
                self.0 = rest;
                Some(match word {
                    b"undefined" => Constant::Undefined,
                    b"null" => Constant::Null,
                    b"true" => Constant::Bool(true),
                    b"false" => Constant::Bool(false),
                    _ => Constant::Number(std::str::from_utf8(word).ok()?.parse().ok()?),
                })
            }
        }
    }
}

impl Constant {
    /// The JavaScript text of the value of a define. `None`: it is neither a primitive nor a literal made of such.
    pub(crate) fn parse(text: &[u8]) -> Option<Constant> {
        let mut reader = Reader(text);
        let value = reader.value()?;
        reader.skip_space();
        reader.0.is_empty().then_some(value)
    }

    pub(crate) fn is_truthy(&self) -> bool {
        match self {
            Constant::Undefined | Constant::Null => false,
            Constant::Bool(value) => *value,
            Constant::Number(value) => *value != 0.0 && !value.is_nan(),
            Constant::String(value) => !value.is_empty(),
            Constant::Object(_) | Constant::Array(_) => true,
        }
    }

    pub(crate) fn is_primitive(&self) -> bool {
        !matches!(self, Constant::Object(_) | Constant::Array(_))
    }

    /// Two such are strictly equal where they are equal here.
    pub(crate) fn is_primitive_but_nan(&self) -> bool {
        self.is_primitive() && !matches!(self, Constant::Number(value) if value.is_nan())
    }

    fn is_nullish(&self) -> bool {
        matches!(self, Constant::Undefined | Constant::Null)
    }
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn emit_constant(&mut self, fx: &mut Fx, constant: &Constant) -> V {
        match constant {
            Constant::Undefined => self.emit(fx, Op::Undefined),
            Constant::Null => self.emit(fx, Op::Null),
            Constant::Bool(value) => self.emit(fx, Op::Bool(*value)),
            Constant::Number(value) => self.number(fx, *value),
            Constant::String(value) => {
                let s = self.out.strs.intern(value);
                self.emit(fx, Op::Str(s))
            }
            Constant::Object(members) => {
                let object = self.emit(fx, Op::NewObject);
                for (name, value) in members {
                    let name = self.out.strs.intern(name);
                    let name = self.emit(fx, Op::Str(name));
                    let value = self.emit_constant(fx, value);
                    self.operation(fx, "DefineField", &[object, name, value]);
                }
                object
            }
            Constant::Array(elements) => {
                let elements = elements.iter().map(|element| self.emit_constant(fx, element)).collect();
                self.emit_throwing(fx, Op::NewArray(elements))
            }
        }
    }

    /// `a.b.c` where `a` is not declared by the program: the dotted name.
    fn global_path(&mut self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => {
                if let Some(found) = self.c.binding_of_identifier(file, e, name) {
                    let sym = self.value_symbol(found);
                    if !self.is_ambient(sym) || self.files.flags(found).contains(SymFlags::ALIAS) {
                        return None;
                    }
                }
                Some(self.c.atoms().bytes(name).to_vec())
            }
            ExprKind::Dot { obj, name, chain: hir::Chain::No, .. } => {
                let mut path = self.global_path(file, obj)?;
                path.push(b'.');
                path.extend_from_slice(self.c.atoms().bytes(name));
                Some(path)
            }
            ExprKind::Index { obj, index, chain: hir::Chain::No } => {
                let name: Atom = match hir[index].kind {
                    ExprKind::String(name) => name,
                    ExprKind::Template { exprs } if exprs.is_empty() => hir.id_at(hir.template_texts(exprs), 0),
                    _ => return None,
                };
                if self.c.atoms().bytes(name).contains(&b'.') {
                    return None;
                }
                let mut path = self.global_path(file, obj)?;
                path.push(b'.');
                path.extend_from_slice(self.c.atoms().bytes(name));
                Some(path)
            }
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.global_path(file, expr),
            _ => None,
        }
    }

    /// The expression is not translated: see `Body::cut`.
    pub(crate) fn cut_expr(&mut self, fx: &Fx, e: ExprId) {
        self.cut_expr_in(fx.file, e);
    }

    fn cut_expr_in(&mut self, file: FileId, e: ExprId) {
        if e.is_some() && !self.only_asks {
            let node = &self.hir(file)[e];
            self.cut.push((node.pos, node.end));
        }
    }

    pub(crate) fn cut_stmt(&mut self, fx: &Fx, stmt: StmtId) {
        if stmt.is_some() {
            let node = &self.hir(fx.file)[stmt];
            self.cut.push((node.start, node.loc.end));
        }
    }

    /// The constant the bundler puts in the place of the expression.
    pub(crate) fn replacement(&mut self, fx: &Fx, e: ExprId) -> Option<Constant> {
        self.replacement_in(fx.file, e)
    }

    pub(crate) fn replacement_in(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        // A define of `__filename` comes first, as in a bundle.
        let found = match self.replacement_of(file, e) {
            Some(found) => found,
            None => self.constant_of_the_environment(file, e)?,
        };
        self.cut_expr_in(file, e);
        Some(found)
    }

    fn replacement_of(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        let hir = self.hir(file);
        let defines = if self.is_builtin_file(file) { &self.shared.builtin_defines } else { &self.shared.defines };
        match hir[e].kind {
            ExprKind::Ident(name) | ExprKind::Dot { name, .. } => {
                if defines.last_names.contains(self.c.atoms().bytes(name)) {
                    let path = self.global_path(file, e)?;
                    if let Some(found) = defines.values.get(&path) {
                        return Some(found.clone());
                    }
                }
                // A member of a literal.
                let ExprKind::Dot { obj, name, chain: hir::Chain::No, .. } = hir[e].kind else { return None };
                let mut root = obj;
                while let ExprKind::Dot { obj, .. } = hir[root].kind {
                    root = obj;
                }
                let ExprKind::Ident(root) = hir[root].kind else { return None };
                if !defines.last_names.contains(self.c.atoms().bytes(root)) {
                    return None;
                }
                let Constant::Object(members) = self.replacement_of(file, obj)? else { return None };
                let name = self.c.atoms().bytes(name);
                // The last of that name is what the object holds.
                members.into_iter().rev().find(|member| member.0 == name).map(|member| member.1)
            }
            // `feature("FLAG")`, imported from `bun:bundle`.
            ExprKind::Call(call) => {
                let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return None };
                if self.c.atoms().bytes(name) != b"feature" || hir[call].args.len() != 1 {
                    return None;
                }
                let found = self.c.binding_of_identifier(file, hir[call].callee, name)?;
                let is_of_the_bundler = self.files.decls(found).into_iter().any(|(file, decl)| match decl {
                    Decl::ImportSpec(spec) => {
                        let hir = self.hir(file);
                        self.c.atoms().bytes(hir[hir[spec].import].spec) == b"bun:bundle"
                    }
                    _ => false,
                });
                let ExprKind::String(flag) = hir[hir.id_at(hir[call].args, 0)].kind else { return None };
                is_of_the_bundler.then(|| Constant::Bool(self.shared.features.contains(self.c.atoms().bytes(flag))))
            }
            _ => None,
        }
    }

    pub(crate) fn constant_of(&self, value: Primitive) -> Constant {
        match value {
            Primitive::Undefined => Constant::Undefined,
            Primitive::Null => Constant::Null,
            Primitive::Bool(value) => Constant::Bool(value),
            Primitive::Number(value) => Constant::Number(value),
            Primitive::String(text) => Constant::String(self.c.atoms().bytes(text).to_vec()),
        }
    }

    /// What a `const` of the program holds that a reference stands for: `Checker::constant_held_by`.
    fn constant_named(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Constant> {
        let found = self.c.symbol_of_identifier(file, e, name)?;
        let sym = self.value_symbol(found);
        // What it holds is known. Where it may not hold it yet, the reference is translated, and throws.
        if self.c.may_be_in_dead_zone(sym, file, e) {
            return None;
        }
        if let Some(value) = self.c.constant_held_by(sym) {
            return Some(self.constant_of(value));
        }
        if let Some(known) = self.constants_by_replacement.get(&sym) {
            return known.clone();
        }
        // For one that is initialized with itself by way of another.
        self.constants_by_replacement.insert(sym, None);
        let (file, init) = self.c.initializer_of_const(sym)?;
        let outer = std::mem::replace(&mut self.only_asks, true);
        let found = self.constant_in(file, init).filter(|value| value.is_primitive() && !matches!(value, Constant::String(text) if text.len() > 64));
        self.only_asks = outer;
        self.constants_by_replacement.insert(sym, found.clone());
        found
    }

    /// What the checker calls a constant expression.
    fn constant_of_the_checker(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        let value = self.c.constant_value_of(file, e)?;
        Some(self.constant_of(value))
    }

    /// The value of an expression made of literals, of constants of the program and of what the bundler replaces.
    pub(crate) fn constant(&mut self, fx: &Fx, e: ExprId) -> Option<Constant> {
        self.constant_in(fx.file, e)
    }

    pub(crate) fn constant_in(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null => Some(Constant::Null),
            ExprKind::True => Some(Constant::Bool(true)),
            ExprKind::False => Some(Constant::Bool(false)),
            ExprKind::Number(index) => Some(Constant::Number(hir.numbers[index as usize])),
            ExprKind::String(value) => Some(Constant::String(self.c.atoms().bytes(value).to_vec())),
            ExprKind::Ident(name) => self.replacement_in(file, e).or_else(|| self.constant_named(file, e, name)),
            ExprKind::Dot { .. } | ExprKind::Call(_) => self.replacement_in(file, e).or_else(|| self.constant_of_the_checker(file, e)),
            ExprKind::Unary { op: hir::UnOp::Not, operand } => Some(Constant::Bool(!self.constant_in(file, operand)?.is_truthy())),
            // `typeof NAME`, where the bundler replaces the name.
            ExprKind::Unary { op: hir::UnOp::Typeof, operand } if matches!(hir[operand].kind, ExprKind::Ident(_) | ExprKind::Dot { .. }) => {
                let kind: &[u8] = match self.replacement_in(file, operand)? {
                    Constant::Undefined => b"undefined",
                    Constant::Bool(_) => b"boolean",
                    Constant::Number(_) => b"number",
                    Constant::String(_) => b"string",
                    Constant::Null | Constant::Object(_) | Constant::Array(_) => b"object",
                };
                Some(Constant::String(kind.to_vec()))
            }
            ExprKind::Binary { op, left, right } => {
                if let Some(found) = self.replacement_in(file, e) {
                    return Some(found);
                }
                let a = self.constant_in(file, left)?;
                match op {
                    hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish => {
                        let takes_right = match op {
                            hir::BinOp::And => a.is_truthy(),
                            hir::BinOp::Or => !a.is_truthy(),
                            _ => a.is_nullish(),
                        };
                        if takes_right {
                            return self.constant_in(file, right);
                        }
                        self.cut_expr_in(file, right);
                        return Some(a);
                    }
                    _ => {}
                }
                let b = self.constant_in(file, right)?;
                // Two objects, which are not the same.
                if !a.is_primitive() || !b.is_primitive() {
                    return None;
                }
                let is_nan = |c: &Constant| matches!(c, Constant::Number(n) if n.is_nan());
                let strictly_equal = a == b && !is_nan(&a);
                match op {
                    hir::BinOp::EqEqEq => Some(Constant::Bool(strictly_equal)),
                    hir::BinOp::NotEqEq => Some(Constant::Bool(!strictly_equal)),
                    // Loose equality of two values of one type, or with `null` and `undefined`.
                    hir::BinOp::EqEq | hir::BinOp::NotEq => {
                        let equal = if a.is_nullish() || b.is_nullish() {
                            a.is_nullish() && b.is_nullish()
                        } else if std::mem::discriminant(&a) == std::mem::discriminant(&b) {
                            strictly_equal
                        } else {
                            return None;
                        };
                        Some(Constant::Bool(equal == (op == hir::BinOp::EqEq)))
                    }
                    hir::BinOp::Lt | hir::BinOp::Le | hir::BinOp::Gt | hir::BinOp::Ge => {
                        let (Constant::Number(a), Constant::Number(b)) = (a, b) else { return None };
                        Some(Constant::Bool(match op {
                            hir::BinOp::Lt => a < b,
                            hir::BinOp::Le => a <= b,
                            hir::BinOp::Gt => a > b,
                            _ => a >= b,
                        }))
                    }
                    _ => self.constant_of_the_checker(file, e),
                }
            }
            ExprKind::Cond { test, yes, no } => {
                let (taken, left_out) = if self.constant_in(file, test)?.is_truthy() { (yes, no) } else { (no, yes) };
                self.cut_expr_in(file, left_out);
                self.constant_in(file, taken)
            }
            _ => self.constant_of_the_checker(file, e),
        }
    }
}
