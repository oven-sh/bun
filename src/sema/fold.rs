use crate::atom::{Atom, known};
use crate::bind::{self, Decl, Parent, PatParent, SymFlags};
use crate::check::locked_builtins::{Builtin, KnownValue, global_object};
use crate::hir::{
    BinOp, Chain, EnumMemberId, ExprId, ExprKind, File, FileKind, Flags, FnBody, FnId, IdList,
    PatId, ResolutionMode, StmtId, StmtKind, UnOp, VarKind,
};
use crate::program::{FileId, Files, Sym};
use crate::util::{FxHashMap, FxHashSet, InParallel, for_each_mut};
use std::cell::{Cell, RefCell};

#[derive(Clone, PartialEq, Debug)]
pub enum Constant {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Vec<u8>),
    Object(Vec<(Vec<u8>, Constant)>),
    Array(Vec<Constant>),
}

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
                    value.extend_from_slice(
                        char::from_u32(code)?.encode_utf8(&mut [0; 4]).as_bytes(),
                    );
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
                let end = self
                    .0
                    .iter()
                    .position(|byte| {
                        matches!(byte, b',' | b'}' | b']') || byte.is_ascii_whitespace()
                    })
                    .unwrap_or(self.0.len());
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
    pub fn parse(text: &[u8]) -> Option<Constant> {
        let mut reader = Reader(text);
        let value = reader.value()?;
        reader.skip_space();
        reader.0.is_empty().then_some(value)
    }

    pub fn is_truthy(&self) -> bool {
        match self {
            Constant::Undefined | Constant::Null => false,
            Constant::Bool(value) => *value,
            Constant::Number(value) => *value != 0.0 && !value.is_nan(),
            Constant::String(value) => !value.is_empty(),
            Constant::Object(_) | Constant::Array(_) => true,
        }
    }

    pub fn is_primitive(&self) -> bool {
        !matches!(self, Constant::Object(_) | Constant::Array(_))
    }

    pub fn is_non_nan_primitive(&self) -> bool {
        self.is_primitive() && !matches!(self, Constant::Number(value) if value.is_nan())
    }

    pub fn is_nullish(&self) -> bool {
        matches!(self, Constant::Undefined | Constant::Null)
    }
}

#[derive(Default, Debug)]
pub struct Defines {
    pub values: FxHashMap<Vec<u8>, Constant>,
    pub last_names: FxHashSet<Vec<u8>>,
    pub dropped: FxHashSet<Vec<u8>>,
}

impl Defines {
    pub fn new<'t>(defines: impl Iterator<Item = (&'t [u8], &'t [u8])>) -> Defines {
        let (dropped, replaced): (Vec<_>, Vec<_>) =
            defines.partition(|(_, value)| value.is_empty());
        let values: FxHashMap<Vec<u8>, Constant> = replaced
            .into_iter()
            .filter_map(|(name, value)| Some((name.to_vec(), Constant::parse(value)?)))
            .collect();
        Defines {
            last_names: values
                .keys()
                .map(|name| {
                    name.rsplit(|&byte| byte == b'.')
                        .next()
                        .unwrap_or_default()
                        .to_vec()
                })
                .collect(),
            values,
            dropped: dropped.into_iter().map(|(name, _)| name.to_vec()).collect(),
        }
    }
}

#[derive(Default, Debug)]
pub struct BuildConstants {
    pub defines: Defines,
    pub features: FxHashSet<Vec<u8>>,
    pub locks_builtins: bool,
    pub bundled_files: Option<FxHashSet<Vec<u8>>>,
}

#[derive(Clone, PartialEq, Debug)]
pub enum Folded {
    Value(Constant),
    Truthy,
    Falsy,
}

impl Folded {
    pub fn is_truthy(&self) -> bool {
        match self {
            Folded::Value(value) => value.is_truthy(),
            Folded::Truthy => true,
            Folded::Falsy => false,
        }
    }

    pub fn is_nullish(&self) -> Option<bool> {
        match self {
            Folded::Value(value) => Some(value.is_nullish()),
            Folded::Truthy => Some(false),
            Folded::Falsy => None,
        }
    }

    fn from_truthiness(is_truthy: bool) -> Folded {
        if is_truthy {
            Folded::Truthy
        } else {
            Folded::Falsy
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Decision {
    pub is_truthy: bool,
    pub is_nullish: Option<bool>,
}

const MAX_DEPTH: u32 = 64;

enum Completion {
    Returns(Folded),
    FallsThrough,
    Unknown,
}

pub struct Folder<'a, 's> {
    files: &'a Files<'s>,
    constants: &'a BuildConstants,
    is_bundled: Option<&'a [bool]>,
    variables: RefCell<FxHashMap<Sym, Option<Folded>>>,
    functions: RefCell<FxHashMap<(FileId, FnId), Option<Folded>>>,
    logical: RefCell<FxHashMap<(FileId, ExprId), Option<Folded>>>,
    unknown: RefCell<FxHashSet<(FileId, ExprId)>>,
    depth: Cell<u32>,
}

impl<'a, 's> Folder<'a, 's> {
    pub fn new(
        files: &'a Files<'s>,
        constants: &'a BuildConstants,
        is_bundled: Option<&'a [bool]>,
    ) -> Folder<'a, 's> {
        Folder {
            files,
            constants,
            is_bundled,
            variables: RefCell::default(),
            functions: RefCell::default(),
            logical: RefCell::default(),
            unknown: RefCell::default(),
            depth: Cell::new(0),
        }
    }

    pub fn decide(&self, file: FileId, e: ExprId) -> Option<Decision> {
        let folded = self.fold(file, e)?;
        Some(Decision {
            is_truthy: folded.is_truthy(),
            is_nullish: folded.is_nullish(),
        })
    }

    pub fn fold(&self, file: FileId, e: ExprId) -> Option<Folded> {
        if e.is_none()
            || self.depth.get() >= MAX_DEPTH
            || self.unknown.borrow().contains(&(file, e))
        {
            return None;
        }
        self.depth.set(self.depth.get() + 1);
        let folded = self.fold_at_depth(file, e);
        self.depth.set(self.depth.get() - 1);
        if folded.is_none() && self.depth.get() == 0 {
            self.unknown.borrow_mut().insert((file, e));
        }
        folded
    }

    fn fold_at_depth(&self, file: FileId, e: ExprId) -> Option<Folded> {
        let hir = self.files.hir(file);
        let atoms = &self.files.atoms;
        let value = |constant: Constant| Some(Folded::Value(constant));
        if is_rooted_in_parameter(hir, self.files.bound(file), e) {
            return None;
        }
        if link_of(hir, e).is_some() {
            let mut at = e;
            while let Some((inner, chain)) = link_of(hir, at) {
                if chain == Chain::Start {
                    return (self.fold(file, inner)?.is_nullish() == Some(true))
                        .then_some(Folded::Value(Constant::Undefined));
                }
                at = inner;
            }
            return None;
        }
        match hir[e].kind {
            ExprKind::Null => value(Constant::Null),
            ExprKind::True => value(Constant::Bool(true)),
            ExprKind::False => value(Constant::Bool(false)),
            ExprKind::Number(index) => value(Constant::Number(hir.numbers[index as usize])),
            ExprKind::String(text) => value(Constant::String(atoms.bytes(text).to_vec())),
            ExprKind::Template { exprs } if exprs.is_empty() => value(Constant::String(
                atoms
                    .bytes(hir.id_at(hir.template_texts(exprs), 0))
                    .to_vec(),
            )),
            ExprKind::Template { exprs } => hir
                .ids(hir.template_texts(exprs))
                .any(|text: Atom| !atoms.bytes(text).is_empty())
                .then_some(Folded::Truthy),
            ExprKind::Regex
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_) => Some(Folded::Truthy),
            ExprKind::Ident(name) => (self.replacement(file, e).map(Folded::Value))
                .or_else(|| self.global_constant(file, e, name).map(Folded::Value))
                .or_else(|| self.fold_variable(file, e))
                .or_else(|| self.fold_builtin(file, e)),
            ExprKind::Dot {
                obj, name, chain, ..
            } => (self.replacement(file, e).map(Folded::Value))
                .or_else(|| {
                    if chain == Chain::No {
                        self.fold_member(file, obj, name)
                    } else {
                        None
                    }
                })
                .or_else(|| self.fold_builtin(file, e)),
            ExprKind::Call(_) => self
                .replacement(file, e)
                .map(Folded::Value)
                .or_else(|| self.fold_call(file, e)),
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => value(Constant::Bool(!self.fold(file, operand)?.is_truthy())),
            ExprKind::Unary { op: UnOp::Void, .. } => value(Constant::Undefined),
            ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            } => self
                .fold_typeof(file, operand)
                .map(|kind| Folded::Value(Constant::String(kind.as_bytes().to_vec()))),
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => match self.fold(file, operand)? {
                Folded::Value(Constant::Number(number)) => value(Constant::Number(-number)),
                _ => None,
            },
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => self.fold_logical(file, e),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.fold(file, right),
            ExprKind::Binary { op, left, right } => {
                let (Folded::Value(a), Folded::Value(b)) =
                    (self.fold(file, left)?, self.fold(file, right)?)
                else {
                    return None;
                };
                compare(op, &a, &b)
                    .map(Constant::Bool)
                    .or_else(|| calculate(op, &a, &b))
                    .map(Folded::Value)
            }
            ExprKind::Cond { test, yes, no } => self.fold(
                file,
                if self.fold(file, test)?.is_truthy() {
                    yes
                } else {
                    no
                },
            ),
            ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => self.fold(file, expr),
            _ => None,
        }
    }

    fn fold_logical(&self, file: FileId, e: ExprId) -> Option<Folded> {
        let hir = self.files.hir(file);
        let mut spine = Vec::new();
        let mut at = e;
        let mut so_far = loop {
            if let Some(known) = self.logical.borrow().get(&(file, at)) {
                break known.clone();
            }
            let ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                left,
                right,
            } = hir[at].kind
            else {
                break self.fold(file, at);
            };
            spine.push((at, op, right));
            at = left;
        };
        while let Some((whole, op, right)) = spine.pop() {
            so_far = match (op, so_far) {
                (BinOp::And, Some(left)) if !left.is_truthy() => Some(left),
                (BinOp::Or, Some(left)) if left.is_truthy() => Some(left),
                (BinOp::And | BinOp::Or, Some(_)) => self.fold(file, right),
                (BinOp::And | BinOp::Or, None) => self
                    .fold(file, right)
                    .filter(|right| right.is_truthy() == (op == BinOp::Or))
                    .map(|right| Folded::from_truthiness(right.is_truthy())),
                (_, Some(left)) => match left.is_nullish() {
                    Some(true) => self.fold(file, right),
                    Some(false) => Some(left),
                    None => None,
                },
                (_, None) => None,
            };
            self.logical
                .borrow_mut()
                .insert((file, whole), so_far.clone());
        }
        so_far
    }

    fn fold_typeof(&self, file: FileId, operand: ExprId) -> Option<&'static str> {
        if let Some(held) = self.known_builtin_value(file, operand) {
            return Some(held.type_of);
        }
        let Folded::Value(constant) = self.fold(file, operand)? else {
            return None;
        };
        Some(match constant {
            Constant::Undefined => "undefined",
            Constant::Bool(_) => "boolean",
            Constant::Number(_) => "number",
            Constant::String(_) => "string",
            Constant::Null | Constant::Object(_) | Constant::Array(_) => "object",
        })
    }

    fn fold_builtin(&self, file: FileId, e: ExprId) -> Option<Folded> {
        self.known_builtin_value(file, e)
            .map(|held| Folded::from_truthiness(held.is_truthy))
    }

    fn known_builtin_value(&self, file: FileId, e: ExprId) -> Option<KnownValue> {
        if !self.constants.locks_builtins {
            return None;
        }
        let (holder, name) = match self.files.hir(file)[e].kind {
            ExprKind::Ident(name) if self.is_global_name(file, e, name) => (global_object(), name),
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => (self.locked_builtin(file, obj)?, name),
            _ => return None,
        };
        holder.known_read_result(self.files.atoms.bytes(name))
    }

    fn locked_builtin(&self, file: FileId, e: ExprId) -> Option<&'static Builtin> {
        match self.files.hir(file)[e].kind {
            ExprKind::Ident(name) if self.is_global_name(file, e, name) => {
                global_object().object_at(self.files.atoms.bytes(name))
            }
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => self
                .locked_builtin(file, obj)?
                .object_at(self.files.atoms.bytes(name)),
            _ => None,
        }
    }

    fn symbol_of(&self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        let bound = self.files.bound(file);
        let local = bound.expr_symbol[e.idx()];
        if local.is_some() {
            return Some(self.files.sym(file, local));
        }
        match bound.free_idents.binary_search_by_key(&e, |free| free.0) {
            Ok(at) => self
                .files
                .resolve(file, bound.free_idents[at].1, name, SymFlags::VALUE, false)
                .ok()
                .flatten(),
            Err(_) => self.files.global(name, SymFlags::VALUE),
        }
    }

    fn is_global_name(&self, file: FileId, e: ExprId, name: Atom) -> bool {
        let Some(found) = self.symbol_of(file, e, name) else {
            return true;
        };
        if self.files.flags(found).contains(SymFlags::ALIAS) {
            return false;
        }
        match self.files.value_declaration(found) {
            Some((of, decl)) => {
                self.files.hir(of).kind == FileKind::Declaration
                    || self
                        .files
                        .bound(of)
                        .modifier_flags(self.files.hir(of), decl)
                        .contains(Flags::AMBIENT)
            }
            None => true,
        }
    }

    fn global_constant(&self, file: FileId, e: ExprId, name: Atom) -> Option<Constant> {
        if self.files.bound(file).expr_symbol[e.idx()].is_some() {
            return None;
        }
        match self.files.atoms.bytes(name) {
            b"undefined" => Some(Constant::Undefined),
            b"NaN" => Some(Constant::Number(f64::NAN)),
            b"Infinity" => Some(Constant::Number(f64::INFINITY)),
            _ => None,
        }
    }

    fn fold_variable(&self, file: FileId, e: ExprId) -> Option<Folded> {
        let local = self.files.bound(file).expr_symbol[e.idx()];
        if local.is_none() {
            return None;
        }
        self.fold_symbol(self.files.sym(file, local))
    }

    fn declaration_in_code(&self, sym: Sym) -> Option<(FileId, Decl)> {
        if !self.files.flags(sym).contains(SymFlags::ALIAS) {
            return self.files.value_declaration(sym);
        }
        let declared = self
            .files
            .value_declaration(self.files.resolve_alias(sym)?)?;
        self.is_bundled
            .is_none_or(|is_bundled| is_bundled[declared.0.idx()])
            .then_some(declared)
    }

    fn fold_symbol(&self, sym: Sym) -> Option<Folded> {
        if let Some(known) = self.variables.borrow().get(&sym) {
            return known.clone();
        }
        self.variables.borrow_mut().insert(sym, None);
        let folded = match self.declaration_in_code(sym) {
            Some((file, Decl::Var(pat))) => self
                .initializer_of_const(file, pat)
                .and_then(|init| self.fold(file, init)),
            Some((file, Decl::EnumMember(member))) => {
                self.fold_enum_member(file, member).map(Folded::Value)
            }
            _ => None,
        };
        self.variables.borrow_mut().insert(sym, folded.clone());
        folded
    }

    fn initializer_of_const(&self, file: FileId, pat: PatId) -> Option<ExprId> {
        let hir = self.files.hir(file);
        let PatParent::Var(declaration) = self.files.bound(file).pat_parent[pat.idx()] else {
            return None;
        };
        let declared = &hir[declaration];
        let is_code = hir.kind != FileKind::Declaration && !declared.flags.contains(Flags::AMBIENT);
        (is_code
            && declared.kind == VarKind::Const
            && declared.pat == pat
            && declared.init.is_some())
        .then_some(declared.init)
    }

    fn fold_enum_member(&self, file: FileId, member: EnumMemberId) -> Option<Constant> {
        let hir = self.files.hir(file);
        let declared = &hir[self.files.bound(file).enum_member_owner[member.idx()]];
        if !declared.flags.contains(Flags::CONST)
            && (hir.kind == FileKind::Declaration || declared.flags.contains(Flags::AMBIENT))
        {
            return None;
        }
        let mut previous = Some(-1.0);
        for at in declared.members.iter() {
            let value = match hir[at].init.is_some() {
                true => match self.fold(file, hir[at].init)? {
                    Folded::Value(value @ (Constant::Number(_) | Constant::String(_))) => value,
                    _ => return None,
                },
                false => Constant::Number(previous? + 1.0),
            };
            if at == member {
                return Some(value);
            }
            previous = match value {
                Constant::Number(number) => Some(number),
                _ => None,
            };
        }
        None
    }

    fn fold_member(&self, file: FileId, obj: ExprId, name: Atom) -> Option<Folded> {
        let ExprKind::Ident(_) = self.files.hir(file)[obj].kind else {
            return None;
        };
        let local = self.files.bound(file).expr_symbol[obj.idx()];
        if local.is_none() {
            return None;
        }
        let named = self.files.sym(file, local);
        let mut holder = named;
        if self.files.flags(holder).contains(SymFlags::ALIAS) {
            holder = self.files.resolve_alias(holder)?;
        }
        if !self
            .files
            .flags(holder)
            .intersects(SymFlags::ENUM | SymFlags::VALUE_MODULE)
        {
            return None;
        }
        match self.files.export(holder, name) {
            Some(member) => self.fold_symbol(member),
            None => (self.is_namespace_import(named)
                && name != known::__esModule
                && self.es_module_lacks_export(holder, name, &mut Vec::new()))
            .then_some(Folded::Value(Constant::Undefined)),
        }
    }

    fn is_namespace_import(&self, sym: Sym) -> bool {
        matches!(self.files.decls(sym).as_slice(), &[(file, Decl::ImportNamespace(import))] if !self.files.hir(file)[import].is_deferred)
    }

    fn es_module_lacks_export(&self, module: Sym, name: Atom, seen: &mut Vec<FileId>) -> bool {
        let Some((file, Decl::File)) = self.files.value_declaration(module) else {
            return false;
        };
        let of = self.files.module(file);
        let runs_as_es_module = match of.is_runtime_commonjs {
            Some(is_commonjs) => !is_commonjs,
            None => self.is_bundled.is_none() && of.implied_format != ResolutionMode::Require,
        };
        if !runs_as_es_module
            || of.is_commonjs()
            || of.builtin.is_some()
            || of.bound.ran_out_of_stack
            || matches!(of.hir.kind, FileKind::Declaration | FileKind::Json)
        {
            return false;
        }
        if self.files.export(module, name).is_some()
            || self.files.export(module, known::export_equals).is_some()
        {
            return false;
        }
        if name == known::default || seen.contains(&file) {
            return true;
        }
        seen.push(file);
        let mut own_stars = of
            .bound
            .export_stars
            .iter()
            .filter(|star| star.0 == of.bound.file_symbol);
        own_stars.all(|star| match of.hir[star.1].kind {
            StmtKind::ExportStar {
                type_only: true, ..
            } => true,
            StmtKind::ExportStar { spec, mode, .. } => {
                let starred = self.files.module_of_specifier_as(
                    file,
                    spec,
                    self.files.mode_of_import(file, mode),
                );
                starred.is_some_and(|starred| self.es_module_lacks_export(starred, name, seen))
            }
            _ => false,
        })
    }

    fn fold_call(&self, file: FileId, e: ExprId) -> Option<Folded> {
        let hir = self.files.hir(file);
        let ExprKind::Call(call) = hir[e].kind else {
            return None;
        };
        let callee = hir[call].callee;
        let local = match hir[callee].kind {
            ExprKind::Ident(_) if hir[call].chain == Chain::No => {
                self.files.bound(file).expr_symbol[callee.idx()]
            }
            _ => return None,
        };
        if local.is_none() {
            return None;
        }
        let sym = self.files.sym(file, local);
        let (of, function) = match self.declaration_in_code(sym)? {
            (of, Decl::Fn(function))
                if !self.files.hir(of).is_js
                    && self.files.hir(of).kind != FileKind::Declaration =>
            {
                (of, function)
            }
            (of, Decl::Var(pat)) => {
                let mut init = self.initializer_of_const(of, pat)?;
                while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } =
                    self.files.hir(of)[init].kind
                {
                    init = expr;
                }
                let ExprKind::Fn(function) = self.files.hir(of)[init].kind else {
                    return None;
                };
                (of, function)
            }
            _ => return None,
        };
        if let Some(known) = self.functions.borrow().get(&(of, function)) {
            return known.clone();
        }
        self.functions.borrow_mut().insert((of, function), None);
        let declared = &self.files.hir(of)[function];
        let folded = match declared.body {
            _ if declared
                .flags
                .intersects(Flags::ASYNC | Flags::GENERATOR | Flags::AMBIENT) =>
            {
                None
            }
            FnBody::Expr(returned) => self.fold(of, returned),
            FnBody::Block(statements) => match self.statements_completion(of, statements) {
                Completion::Returns(returned) => Some(returned),
                Completion::FallsThrough => Some(Folded::Value(Constant::Undefined)),
                Completion::Unknown => None,
            },
            FnBody::None => None,
        };
        self.functions
            .borrow_mut()
            .insert((of, function), folded.clone());
        folded
    }

    fn statements_completion(&self, file: FileId, statements: IdList<StmtId>) -> Completion {
        for statement in self.files.hir(file).ids(statements) {
            let completion = self.statement_completion(file, statement);
            if !matches!(completion, Completion::FallsThrough) {
                return completion;
            }
        }
        Completion::FallsThrough
    }

    fn statement_completion(&self, file: FileId, statement: StmtId) -> Completion {
        if statement.is_none() {
            return Completion::FallsThrough;
        }
        if self.depth.get() >= MAX_DEPTH {
            return Completion::Unknown;
        }
        let hir = self.files.hir(file);
        self.depth.set(self.depth.get() + 1);
        let completion = match hir[statement].kind {
            StmtKind::Return(returned) if returned.is_none() => {
                Completion::Returns(Folded::Value(Constant::Undefined))
            }
            StmtKind::Return(returned) => self
                .fold(file, returned)
                .map_or(Completion::Unknown, Completion::Returns),
            StmtKind::If { test, yes, no } => match self.fold(file, test) {
                Some(test) => {
                    self.statement_completion(file, if test.is_truthy() { yes } else { no })
                }
                None => Completion::Unknown,
            },
            StmtKind::Block(statements) if hir.with_bodies.is_empty() => {
                self.statements_completion(file, statements)
            }
            StmtKind::Empty
            | StmtKind::Expr(_)
            | StmtKind::Var(_)
            | StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_) => Completion::FallsThrough,
            _ => Completion::Unknown,
        };
        self.depth.set(self.depth.get() - 1);
        completion
    }

    fn global_path(&self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        let hir = self.files.hir(file);
        let atoms = &self.files.atoms;
        let member = |obj: ExprId, name: Atom| {
            let mut path = self.global_path(file, obj)?;
            path.push(b'.');
            path.extend_from_slice(atoms.bytes(name));
            Some(path)
        };
        match hir[e].kind {
            ExprKind::Ident(name) => self
                .is_global_name(file, e, name)
                .then(|| atoms.bytes(name).to_vec()),
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => member(obj, name),
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } => {
                let name: Atom = match hir[index].kind {
                    ExprKind::String(name) => name,
                    ExprKind::Template { exprs } if exprs.is_empty() => {
                        hir.id_at(hir.template_texts(exprs), 0)
                    }
                    _ => return None,
                };
                if bun_core::strings::contains_char(atoms.bytes(name), b'.') {
                    return None;
                }
                member(obj, name)
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::NonNull(expr) => self.global_path(file, expr),
            _ => None,
        }
    }

    fn is_dropped_call(&self, file: FileId, callee: ExprId) -> bool {
        let (hir, dropped) = (self.files.hir(file), &self.constants.defines.dropped);
        let mut named = callee;
        while !dropped.is_empty() {
            if self
                .global_path(file, named)
                .is_some_and(|path| dropped.contains(&path))
            {
                return true;
            }
            let ExprKind::Dot { obj, .. } = hir[named].kind else {
                break;
            };
            named = obj;
        }
        false
    }

    pub fn replacement(&self, file: FileId, e: ExprId) -> Option<Constant> {
        let hir = self.files.hir(file);
        let atoms = &self.files.atoms;
        let defines = &self.constants.defines;
        match hir[e].kind {
            ExprKind::Ident(_) | ExprKind::Dot { .. } if defines.values.is_empty() => None,
            ExprKind::Ident(name) | ExprKind::Dot { name, .. } => {
                if defines.last_names.contains(atoms.bytes(name)) {
                    let path = self.global_path(file, e)?;
                    if let Some(found) = defines.values.get(&path) {
                        return Some(found.clone());
                    }
                }
                let ExprKind::Dot {
                    obj,
                    name,
                    chain: Chain::No,
                    ..
                } = hir[e].kind
                else {
                    return None;
                };
                let mut root = obj;
                while let ExprKind::Dot { obj, .. } = hir[root].kind {
                    root = obj;
                }
                let ExprKind::Ident(root) = hir[root].kind else {
                    return None;
                };
                if !defines.last_names.contains(atoms.bytes(root)) {
                    return None;
                }
                let Constant::Object(members) = self.replacement(file, obj)? else {
                    return None;
                };
                let name = atoms.bytes(name);
                members
                    .into_iter()
                    .rev()
                    .find(|member| member.0 == name)
                    .map(|member| member.1)
            }
            ExprKind::Call(call) => {
                if self.is_dropped_call(file, hir[call].callee) {
                    return Some(Constant::Undefined);
                }
                let ExprKind::Ident(name) = hir[hir[call].callee].kind else {
                    return None;
                };
                if atoms.bytes(name) != b"feature" || hir[call].args.len() != 1 {
                    return None;
                }
                let found = self.symbol_of(file, hir[call].callee, name)?;
                let is_bundler_constant =
                    self.files
                        .decls(found)
                        .into_iter()
                        .any(|(of, decl)| match decl {
                            Decl::ImportSpec(spec) => {
                                let hir = self.files.hir(of);
                                atoms.bytes(hir[hir[spec].import].spec) == b"bun:bundle"
                            }
                            _ => false,
                        });
                let ExprKind::String(flag) = hir[hir.id_at(hir[call].args, 0)].kind else {
                    return None;
                };
                is_bundler_constant
                    .then(|| Constant::Bool(self.constants.features.contains(atoms.bytes(flag))))
            }
            _ => None,
        }
    }

    pub fn entered_case(&self, file: FileId, switch: StmtId) -> Option<usize> {
        let hir = self.files.hir(file);
        let StmtKind::Switch { expr, cases } = hir[switch].kind else {
            return None;
        };
        let primitive = |e: ExprId| match self.fold(file, e) {
            Some(Folded::Value(constant)) if constant.is_non_nan_primitive() => Some(constant),
            _ => None,
        };
        let switched_on = primitive(expr)?;
        for (at, case) in cases.iter().enumerate() {
            if hir[case].test.is_some() && primitive(hir[case].test)? == switched_on {
                return Some(at);
            }
        }
        Some(
            cases
                .iter()
                .position(|case| hir[case].test.is_none())
                .unwrap_or(cases.len()),
        )
    }
}

fn compare(op: BinOp, a: &Constant, b: &Constant) -> Option<bool> {
    if !a.is_primitive() || !b.is_primitive() {
        return None;
    }
    let is_nan =
        |constant: &Constant| matches!(constant, Constant::Number(number) if number.is_nan());
    let strictly_equal = a == b && !is_nan(a);
    match op {
        BinOp::EqEqEq => Some(strictly_equal),
        BinOp::NotEqEq => Some(!strictly_equal),
        BinOp::EqEq | BinOp::NotEq => {
            let equal = if a.is_nullish() || b.is_nullish() {
                a.is_nullish() && b.is_nullish()
            } else if std::mem::discriminant(a) == std::mem::discriminant(b) {
                strictly_equal
            } else {
                return None;
            };
            Some(equal == (op == BinOp::EqEq))
        }
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
            let (Constant::Number(a), Constant::Number(b)) = (a, b) else {
                return None;
            };
            Some(match op {
                BinOp::Lt => a < b,
                BinOp::Le => a <= b,
                BinOp::Gt => a > b,
                _ => a >= b,
            })
        }
        _ => None,
    }
}

fn calculate(op: BinOp, a: &Constant, b: &Constant) -> Option<Constant> {
    if let (BinOp::Add, Constant::String(a), Constant::String(b)) = (op, a, b) {
        let mut text = [&a[..], &b[..]].concat();
        crate::check::combine_surrogate_pairs(&mut text);
        return Some(Constant::String(text));
    }
    let (&Constant::Number(a), &Constant::Number(b)) = (a, b) else {
        return None;
    };
    let to_int32 = |number: f64| {
        if number.is_finite() {
            (number.trunc() % 4294967296.0) as i64 as i32
        } else {
            0
        }
    };
    let shift = to_int32(b) as u32 & 31;
    Some(Constant::Number(match op {
        BinOp::Add => a + b,
        BinOp::Sub => a - b,
        BinOp::Mul => a * b,
        BinOp::Div => a / b,
        BinOp::BitAnd => f64::from(to_int32(a) & to_int32(b)),
        BinOp::BitOr => f64::from(to_int32(a) | to_int32(b)),
        BinOp::BitXor => f64::from(to_int32(a) ^ to_int32(b)),
        BinOp::Shl => f64::from(to_int32(a).wrapping_shl(shift)),
        BinOp::Shr => f64::from(to_int32(a) >> shift),
        BinOp::UShr => f64::from(to_int32(a) as u32 >> shift),
        _ => return None,
    }))
}

struct DeadStatements<'a, 's> {
    hir: &'a File<'s>,
    decisions: &'a [(ExprId, Decision)],
    entered_cases: &'a [(StmtId, usize)],
    found: Vec<StmtId>,
}

impl DeadStatements<'_, '_> {
    fn completes_all(&mut self, statements: IdList<StmtId>) -> bool {
        let mut completes = true;
        for statement in self.hir.ids(statements) {
            match completes {
                true => completes = self.completes(statement),
                false => self.found.push(statement),
            }
        }
        completes
    }

    fn completes(&mut self, statement: StmtId) -> bool {
        if statement.is_none() {
            return true;
        }
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_) => false,
            StmtKind::Block(statements) => self.completes_all(statements),
            StmtKind::If { test, yes, no } => match find_decision(self.decisions, test) {
                Some(decision) => {
                    let (taken, cut) = if decision.is_truthy {
                        (yes, no)
                    } else {
                        (no, yes)
                    };
                    self.found.extend(cut.some());
                    self.completes(taken)
                }
                None => {
                    let (yes, no) = (self.completes(yes), self.completes(no));
                    yes || no
                }
            },
            StmtKind::While { test, body } | StmtKind::For { test, body, .. } => {
                match find_decision(self.decisions, test) {
                    Some(decision) if !decision.is_truthy => self.found.push(body),
                    _ => _ = self.completes(body),
                }
                true
            }
            StmtKind::DoWhile { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::Labeled { body, .. } => {
                self.completes(body);
                true
            }
            StmtKind::Try {
                block,
                handler,
                finalizer,
                ..
            } => {
                for part in [block, handler, finalizer] {
                    self.completes(part);
                }
                true
            }
            StmtKind::Switch { cases, .. } => {
                let entered = self
                    .entered_cases
                    .binary_search_by_key(&statement, |entered| entered.0)
                    .ok()
                    .map(|at| self.entered_cases[at].1);
                let mut is_reached = entered.is_none();
                for (at, case) in cases.iter().enumerate() {
                    is_reached |= entered == Some(at);
                    match is_reached {
                        true => {
                            is_reached = self.completes_all(hir[case].body) || entered.is_none()
                        }
                        false => self.found.extend(hir.ids::<StmtId>(hir[case].body)),
                    }
                }
                true
            }
            StmtKind::Module(module) => {
                self.completes_all(hir[module].body);
                true
            }
            _ => true,
        }
    }
}

struct FoldedFile {
    file: FileId,
    decisions: Vec<(ExprId, Decision)>,
    cut: Vec<(u32, u32)>,
}

fn is_rooted_in_parameter(hir: &File, bound: &bind::Bound, e: ExprId) -> bool {
    let mut at = e;
    loop {
        match hir[at].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => at = obj,
            ExprKind::Call(call) => at = hir[call].callee,
            ExprKind::Ident(_) => {
                let local = bound.expr_symbol[at.idx()];
                return local.is_some()
                    && matches!(
                        bound.symbols[local.idx()].decls.as_slice(),
                        [Decl::Param(_)]
                    );
            }
            _ => return false,
        }
    }
}

fn link_of(hir: &File, e: ExprId) -> Option<(ExprId, Chain)> {
    match hir[e].kind {
        ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. }
            if chain != Chain::No =>
        {
            Some((obj, chain))
        }
        ExprKind::Call(call) if hir[call].chain != Chain::No => {
            Some((hir[call].callee, hir[call].chain))
        }
        ExprKind::NonNull(inner) if link_of(hir, inner).is_some() => Some((inner, Chain::Continue)),
        _ => None,
    }
}

fn short_circuiting_root_in(
    hir: &File,
    decisions: &[(ExprId, Decision)],
    e: ExprId,
) -> Option<ExprId> {
    let mut at = e;
    while let Some((inner, chain)) = link_of(hir, at) {
        if chain == Chain::Start {
            return (find_decision(decisions, inner)?.is_nullish == Some(true)).then_some(inner);
        }
        at = inner;
    }
    None
}

fn find_decision(decisions: &[(ExprId, Decision)], e: ExprId) -> Option<Decision> {
    let at = decisions
        .binary_search_by_key(&e, |decision| decision.0)
        .ok()?;
    Some(decisions[at].1)
}

fn dead_operand_of(kind: ExprKind, decisions: &[(ExprId, Decision)]) -> Option<ExprId> {
    match kind {
        ExprKind::Cond { test, yes, no } => {
            find_decision(decisions, test).map(|decision| if decision.is_truthy { no } else { yes })
        }
        ExprKind::Binary {
            op: BinOp::And,
            left,
            right,
        } => find_decision(decisions, left)
            .filter(|decision| !decision.is_truthy)
            .map(|_| right),
        ExprKind::Binary {
            op: BinOp::Or,
            left,
            right,
        } => find_decision(decisions, left)
            .filter(|decision| decision.is_truthy)
            .map(|_| right),
        ExprKind::Binary {
            op: BinOp::Nullish,
            left,
            right,
        } => find_decision(decisions, left)
            .filter(|decision| decision.is_nullish == Some(false))
            .map(|_| right),
        _ => None,
    }
}

fn result_operand_in(kind: ExprKind, decisions: &[(ExprId, Decision)]) -> Option<ExprId> {
    match kind {
        ExprKind::Cond { test, yes, no } => {
            find_decision(decisions, test).map(|decision| if decision.is_truthy { yes } else { no })
        }
        ExprKind::Binary {
            op: BinOp::And,
            left,
            right,
        } => find_decision(decisions, left)
            .map(|decision| if decision.is_truthy { right } else { left }),
        ExprKind::Binary {
            op: BinOp::Or,
            left,
            right,
        } => find_decision(decisions, left)
            .map(|decision| if decision.is_truthy { left } else { right }),
        ExprKind::Binary {
            op: BinOp::Nullish,
            left,
            right,
        } => find_decision(decisions, left)?
            .is_nullish
            .map(|is_nullish| if is_nullish { right } else { left }),
        _ => None,
    }
}

fn runs(kind: StmtKind) -> bool {
    matches!(
        kind,
        StmtKind::Debugger
            | StmtKind::Expr(_)
            | StmtKind::Var(_)
            | StmtKind::Return(_)
            | StmtKind::If { .. }
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::Block(_)
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Labeled { .. }
    )
}

fn is_within(ranges: &[(u32, u32)], pos: u32) -> bool {
    let after = ranges.partition_point(|range| range.0 <= pos);
    after != 0 && pos < ranges[after - 1].1
}

fn is_loop_head(hir: &File, bound: &bind::Bound, statement: StmtId) -> bool {
    matches!(bound.stmt_parent[statement.idx()], Parent::Stmt(parent)
        if matches!(hir[parent].kind, StmtKind::For { init: head, .. } | StmtKind::ForIn { left: head, .. } | StmtKind::ForOf { left: head, .. } if head == statement))
}

impl<'s> Files<'s> {
    pub fn decision(&self, file: FileId, e: ExprId) -> Option<Decision> {
        find_decision(self.module(file).decisions, e)
    }

    pub fn dead_operand(&self, file: FileId, e: ExprId) -> Option<ExprId> {
        let decisions = self.module(file).decisions;
        if decisions.is_empty() {
            return None;
        }
        dead_operand_of(self.hir(file)[e].kind, decisions)
    }

    pub fn result_operand(&self, file: FileId, e: ExprId) -> Option<ExprId> {
        let decisions = self.module(file).decisions;
        if decisions.is_empty() {
            return None;
        }
        result_operand_in(self.hir(file)[e].kind, decisions)
    }

    pub fn short_circuiting_root(&self, file: FileId, e: ExprId) -> Option<ExprId> {
        let decisions = self.module(file).decisions;
        if decisions.is_empty() {
            return None;
        }
        short_circuiting_root_in(self.hir(file), decisions, e)
    }

    pub fn enclosing_dead_range_start(&self, file: FileId, pos: u32) -> Option<u32> {
        let cut = self.module(file).cut;
        let after = cut.partition_point(|range| range.0 <= pos);
        (after != 0 && pos < cut[after - 1].1).then(|| cut[after - 1].0)
    }

    pub fn is_dead_statement(&self, file: FileId, statement: StmtId) -> bool {
        is_within(self.module(file).cut, self.hir(file)[statement].start)
    }

    fn dead_ranges(
        &self,
        file: FileId,
        decisions: &[(ExprId, Decision)],
        entered_cases: &[(StmtId, usize)],
        decides_statements: bool,
    ) -> Vec<(u32, u32)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut dead = DeadStatements {
            hir,
            decisions,
            entered_cases,
            found: Vec::new(),
        };
        if decides_statements {
            dead.completes_all(hir.body);
            for function in hir.fns.iter() {
                if let FnBody::Block(statements) = function.body {
                    dead.completes_all(statements);
                }
            }
        }
        let statements = (hir.stmts.iter().enumerate())
            .filter(|&(at, _)| {
                bound.stmt_flow[at] == bind::UNREACHABLE
                    && !matches!(bound.stmt_parent[at], Parent::None)
                    && !is_loop_head(hir, bound, StmtId(at as u32))
            })
            .map(|(_, statement)| statement)
            .chain(dead.found.iter().map(|&statement| &hir[statement]))
            .filter(|statement| runs(statement.kind))
            .map(|statement| (statement.start, statement.loc.end));
        let operands = (hir.exprs.iter().enumerate())
            .filter(|&(at, _)| {
                !decisions.is_empty() && !matches!(bound.expr_parent[at], Parent::None)
            })
            .filter_map(|(_, expr)| dead_operand_of(expr.kind, decisions))
            .map(|cut| (hir[cut].pos, hir[cut].end));
        let chains = (hir.exprs.iter().enumerate())
            .filter(|&(at, _)| {
                !decisions.is_empty() && !matches!(bound.expr_parent[at], Parent::None)
            })
            .filter_map(|(at, expr)| {
                Some((
                    hir[short_circuiting_root_in(hir, decisions, ExprId(at as u32))?].end,
                    expr.end,
                ))
            });
        let mut ranges: Vec<(u32, u32)> = statements
            .chain(operands)
            .chain(chains)
            .filter(|range| range.0 < range.1)
            .collect();
        ranges.sort_unstable();
        let mut merged: Vec<(u32, u32)> = Vec::new();
        for range in ranges {
            match merged.last_mut() {
                Some(last) if range.0 < last.1 => last.1 = last.1.max(range.1),
                _ => merged.push(range),
            }
        }
        merged
    }

    fn decisions_in(
        &self,
        folder: &Folder<'_, 's>,
        file: FileId,
    ) -> (Vec<(ExprId, Decision)>, Vec<(StmtId, usize)>, bool) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut deciding: Vec<ExprId> = Vec::new();
        for (at, expr) in hir.exprs.iter().enumerate() {
            if matches!(bound.expr_parent[at], Parent::None) {
                continue;
            }
            match expr.kind {
                ExprKind::Cond { test, .. } => deciding.push(test),
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    left,
                    ..
                } => deciding.push(left),
                ExprKind::Dot {
                    obj,
                    chain: Chain::Start,
                    ..
                }
                | ExprKind::Index {
                    obj,
                    chain: Chain::Start,
                    ..
                } => deciding.push(obj),
                ExprKind::Call(call) if hir[call].chain == Chain::Start => {
                    deciding.push(hir[call].callee)
                }
                _ => {}
            }
        }
        let mut entered_cases = Vec::new();
        let mut statement_tests = Vec::new();
        for (at, statement) in hir.stmts.iter().enumerate() {
            if matches!(bound.stmt_parent[at], Parent::None) {
                continue;
            }
            match statement.kind {
                StmtKind::If { test, .. }
                | StmtKind::While { test, .. }
                | StmtKind::DoWhile { test, .. }
                | StmtKind::For { test, .. }
                    if test.is_some()
                        && !matches!(hir[test].kind, ExprKind::True | ExprKind::False) =>
                {
                    deciding.push(test);
                    statement_tests.push(test);
                }
                StmtKind::Switch { .. } => entered_cases.extend(
                    folder
                        .entered_case(file, StmtId(at as u32))
                        .map(|entered| (StmtId(at as u32), entered)),
                ),
                _ => {}
            }
        }
        deciding.sort_unstable();
        deciding.dedup();
        let decisions: Vec<(ExprId, Decision)> = deciding
            .into_iter()
            .filter_map(|e| Some((e, folder.decide(file, e)?)))
            .collect();
        let decides_statements = !entered_cases.is_empty()
            || statement_tests
                .into_iter()
                .any(|test| find_decision(&decisions, test).is_some());
        (decisions, entered_cases, decides_statements)
    }

    pub fn fold_constants(
        &mut self,
        session: &'s crate::session::Session,
        constants: Option<std::sync::Arc<BuildConstants>>,
        in_parallel: InParallel<'_>,
    ) {
        let Some(constants) = constants else { return };
        let is_folded = |module: &crate::program::Module<'s>| {
            !matches!(module.hir.kind, FileKind::Declaration | FileKind::Json)
                && module.builtin.is_none()
                && !module.bound.ran_out_of_stack
        };
        let mut folded: Vec<FoldedFile> = (0..self.modules.len())
            .filter(|&at| is_folded(&self.modules[at]))
            .map(|at| FoldedFile {
                file: FileId(at as u32),
                decisions: Vec::new(),
                cut: Vec::new(),
            })
            .collect();
        let files = &*self;
        let is_bundled: Option<Vec<bool>> = constants.bundled_files.as_ref().map(|bundled| {
            let mut is_bundled = vec![false; files.modules.len()];
            for file in bundled.iter().filter_map(|path| files.by_path.get(path)) {
                is_bundled[file.idx()] = true;
            }
            is_bundled
        });
        for_each_mut(&mut folded, in_parallel, &|of_file| {
            let folder = Folder::new(files, &constants, is_bundled.as_deref());
            let (decisions, entered_cases, decides_statements) =
                files.decisions_in(&folder, of_file.file);
            of_file.cut =
                files.dead_ranges(of_file.file, &decisions, &entered_cases, decides_statements);
            of_file.decisions = decisions;
        });
        let arena = session.arena();
        for of_file in folded {
            let module = &mut *self.modules[of_file.file.idx()];
            if !of_file.decisions.is_empty() {
                module.decisions = arena.alloc_slice_copy(&of_file.decisions);
            }
            if !of_file.cut.is_empty() {
                module.cut = arena.alloc_slice_copy(&of_file.cut);
            }
        }
    }
}
