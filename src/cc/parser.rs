//! The parser: tokens -> typed AST.
//!
//! The parser owns no source text. It pulls preprocessing tokens from a [`TokenSource`],
//! classifies them (`token::classify`), and recognises the C grammar. Meaning — scopes,
//! types, conversions — is delegated to [`Sema`].

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::ast::*;
use crate::extended::Extended;
use crate::init::{Designator, Init, InitEntry, MAX_OBJECT_SIZE};
use crate::sema::builtin::{Precision, SignFrom};
use crate::sema::{FieldDecl, FnCtx, Sema, Storage, Symbol, Tag};
use crate::token::{
    Kw, Loc, PackOp, Punct, Res, Tok, Token, TokenSource, classify, err, err_with_note,
};
use crate::types::{FuncType, Quals, StructId, Target, Type, WideKind};

#[path = "parser_ms.rs"]
pub(crate) mod microsoft;

/// Maximum nesting of recursive grammar productions (parentheses, blocks, declarators,
/// brace initializers): a limit of this implementation (C11 5.2.4.1 asks for 127 levels of
/// blocks and 63 of parentheses), which also bounds every pass that walks what was parsed.
const MAX_NESTING: u32 = 500;

/// An upper bound of the stack one level of nesting costs the deepest of the passes that walk
/// a function body after it has been parsed.
const STACK_PER_LEVEL: usize = if cfg!(debug_assertions) {
    16 << 10
} else {
    2 << 10
};

/// Maximum number of pointer, array and function derivations in one type (C11 5.2.4.1 asks
/// for 12 in a declaration), which bounds every walk over a type.
const MAX_DERIVATIONS: usize = 256;

/// What the attributes on a declaration asked for; everything else is ignored.
#[derive(Default, Clone)]
struct Attrs {
    aligned: Option<u64>,
    /// `_Alignas` was written (the keyword, which may appear in fewer places than the attribute),
    /// asking for this much.
    alignas: Option<(u64, Loc)>,
    packed: bool,
    /// `__asm__("name")`: the symbol name to link against.
    asm_label: Option<Rc<str>>,
    /// `vector_size(bytes)`.
    vector_bytes: Option<(i64, Loc)>,
    /// `ext_vector_type(count)`.
    vector_count: Option<(i64, Loc)>,
    /// `constructor` / `destructor`, with the priority (65535 if there is none).
    constructor: Option<u32>,
    destructor: Option<u32>,
    /// `alias("target")`.
    alias: Option<(Rc<str>, Loc)>,
    /// `cleanup(function)`.
    cleanup: Option<(Rc<str>, Loc)>,
    /// `transparent_union`.
    transparent_union: bool,
    /// `ms_struct` (true) or `gcc_struct` (false): whose bit-field layout a structure has.
    ms_struct: Option<bool>,
    /// `always_inline` / `noinline`, as `bir::INLINE_*`.
    inlining: u8,
    /// `gnu_inline`: `extern inline` and plain `inline` mean what they meant before C99.
    gnu_inline: bool,
    /// `mode(name)`.
    mode: Option<(Rc<str>, Loc)>,
    /// `weak`.
    weak: bool,
    /// `__declspec(thread)`.
    thread: bool,
    /// `__declspec(selectany)`.
    selectany: bool,
    /// `__declspec(align(N))`, Microsoft's spelling (it is in `aligned` too): written ahead of
    /// a structure's definition it is the structure's, not the declared object's.
    declspec_align: Option<u64>,
}

struct DeclSpec {
    ty: Type,
    storage: Storage,
    is_register: bool,
    is_auto: bool,
    is_typedef: bool,
    is_inline: bool,
    is_noreturn: bool,
    incomplete_enum: Option<Rc<str>>,
    thread_local: bool,
    attrs: Attrs,
    loc: Loc,
}

struct Param {
    ty: Type,
    name: Option<Rc<str>>,
    loc: Loc,
    /// The type the parameter's variable has: `ty`, plus `volatile` if it was declared so.
    local_ty: Type,
    is_register: bool,
}

enum DeclOp {
    Ptr {
        atomic: bool,
        quals: Quals,
    },
    Array(ArrayLen, Loc),
    Func {
        params: Vec<Param>,
        variadic: bool,
        unprototyped: bool,
        loc: Loc,
    },
}

enum ArrayLen {
    /// `[]`.
    Unspecified,
    Const(u64),
    /// A length that is not an integer constant expression: a variable length array.
    Dynamic(Expr),
    /// `[*]`.
    Star,
}

struct Declarator {
    ty: Type,
    name: Option<Rc<str>>,
    loc: Loc,
    /// Attributes and the asm label written after the declarator.
    attrs: Attrs,
    /// Parameters of the outermost function declarator, when the declared entity is a function.
    params: Option<Vec<Param>>,
}

struct SwitchCtx {
    /// The variable length array scopes around the `switch` itself.
    vla_path: Vec<u32>,
    cond_ty: Type,
    cases: Vec<SwitchCase>,
    /// The values `cases` cover, as ranges from a first to a last key in the order of `cond_ty`.
    ranges: std::collections::BTreeMap<u64, u64>,
    default: Option<LabelId>,
}

pub(crate) struct Parser<S: TokenSource> {
    src: S,
    dialect: crate::token::Dialect,
    cur: Token,
    next: Option<Token>,
    sema: Sema,
    nesting: u32,
    /// The highest `nesting` has been since this was last reset.
    deepest_nesting: u32,
    /// Attributes read ahead of a block-scope declaration.
    leading_attrs: Option<Attrs>,
    switches: Vec<SwitchCtx>,
    break_targets: u32,
    continue_targets: u32,
    /// How many parameter lists enclose the current position.
    param_depth: u32,
    /// `count = length` assignments of variable length array types that were just parsed
    /// and must be evaluated at this point of the program.
    pending_vla: Vec<Expr>,
    /// Set by an `enum tag` specifier whose enumeration has no enumerator list yet: an
    /// incomplete type, which only a pointer may be made of.
    incomplete_enum: Option<Rc<str>>,
    /// The structures and unions whose member lists are open at the current position.
    open_structs: Vec<StructId>,
    /// The `VlaScope`s around the current position, outermost first.
    vla_path: Vec<u32>,
    /// A variable length array object was declared by the block item just parsed.
    vla_declared: bool,
    /// Every `goto` of the current function: target, the scopes around it, where.
    gotos: Vec<(LabelId, Vec<u32>, Loc)>,
    /// Where the current function has a `goto *`, if it does.
    computed_goto: Option<Loc>,
    /// Where the outermost parameter list of the declaration being parsed says `[*]`.
    star_bound: Option<Loc>,
    /// `#pragma pack`: the most a member may be aligned to, and the values pushed.
    pack: Option<u64>,
    pack_stack: Vec<Option<u64>>,
    /// `#pragma ms_struct on` is in effect.
    ms_struct: bool,
    /// How many parentheses of a declarator (`(*name)`) are open.
    declarator_parens: u32,
    /// The `cleanup` calls of the variables the current block item declared.
    pending_cleanups: Vec<Expr>,
    /// A `cleanup` attribute written among a declarator's pointer qualifiers
    /// (`char *__attribute__((cleanup(f))) p`): it belongs to the variable being declared.
    declarator_cleanup: Option<(Rc<str>, Loc)>,
    /// See `Attrs::declspec_align`.
    declspec_struct_align: Option<u64>,
}

fn binary_precedence(p: Punct) -> Option<(u32, Option<BinOp>)> {
    Some(match p {
        Punct::PipePipe => (1, None),
        Punct::AmpAmp => (2, None),
        Punct::Pipe => (3, Some(BinOp::Or)),
        Punct::Caret => (4, Some(BinOp::Xor)),
        Punct::Amp => (5, Some(BinOp::And)),
        Punct::EqEq => (6, Some(BinOp::Eq)),
        Punct::Ne => (6, Some(BinOp::Ne)),
        Punct::Lt => (7, Some(BinOp::Lt)),
        Punct::Gt => (7, Some(BinOp::Gt)),
        Punct::Le => (7, Some(BinOp::Le)),
        Punct::Ge => (7, Some(BinOp::Ge)),
        Punct::Shl => (8, Some(BinOp::Shl)),
        Punct::Shr => (8, Some(BinOp::Shr)),
        Punct::Plus => (9, Some(BinOp::Add)),
        Punct::Minus => (9, Some(BinOp::Sub)),
        Punct::Star => (10, Some(BinOp::Mul)),
        Punct::Slash => (10, Some(BinOp::Div)),
        Punct::Percent => (10, Some(BinOp::Rem)),
        _ => return None,
    })
}

fn compound_assign_op(p: Punct) -> Option<BinOp> {
    Some(match p {
        Punct::StarAssign => BinOp::Mul,
        Punct::SlashAssign => BinOp::Div,
        Punct::PercentAssign => BinOp::Rem,
        Punct::PlusAssign => BinOp::Add,
        Punct::MinusAssign => BinOp::Sub,
        Punct::ShlAssign => BinOp::Shl,
        Punct::ShrAssign => BinOp::Shr,
        Punct::AmpAssign => BinOp::And,
        Punct::CaretAssign => BinOp::Xor,
        Punct::PipeAssign => BinOp::Or,
        _ => return None,
    })
}

impl<S: TokenSource> Parser<S> {
    pub(crate) fn new(src: S, target: Target) -> Res<Parser<S>> {
        let mut parser = Parser {
            src,
            dialect: target.dialect(),
            cur: Token {
                tok: Tok::Eof,
                loc: Loc::default(),
            },
            next: None,
            sema: Sema::new(target),
            nesting: 0,
            deepest_nesting: 0,
            leading_attrs: None,
            switches: Vec::new(),
            break_targets: 0,
            continue_targets: 0,
            param_depth: 0,
            pending_vla: Vec::new(),
            incomplete_enum: None,
            open_structs: Vec::new(),
            vla_path: Vec::new(),
            vla_declared: false,
            gotos: Vec::new(),
            computed_goto: None,
            star_bound: None,
            pack: None,
            pack_stack: Vec::new(),
            ms_struct: false,
            declarator_parens: 0,
            pending_cleanups: Vec::new(),
            declarator_cleanup: None,
            declspec_struct_align: None,
        };
        parser.cur = parser.fetch()?;
        Ok(parser)
    }

    // ───────────────────────────── token plumbing ─────────────────────────────

    /// The next token. `#pragma pack` takes effect here, where it sits in the token stream.
    fn fetch(&mut self) -> Res<Token> {
        loop {
            let token = classify(
                &self.src.next_token()?,
                self.dialect,
                &mut self.sema.warnings.borrow_mut(),
            )?;
            let op = match &token.tok {
                Tok::Kw(Kw::MsIgnored) => continue,
                Tok::Kw(Kw::VectorCall) => {
                    return err(
                        token.loc,
                        "__vectorcall is not supported: it changes how arguments are passed",
                    );
                }
                Tok::PragmaPack(op) => *op,
                Tok::PragmaWeak(name) => {
                    self.sema.pragma_weak.push((Rc::clone(name), token.loc));
                    continue;
                }
                Tok::PragmaMsStruct(on) => {
                    self.ms_struct = *on;
                    continue;
                }
                Tok::PragmaRedefine(old, new) => {
                    self.sema
                        .redefined_names
                        .push((Rc::clone(old), Rc::clone(new)));
                    continue;
                }
                _ => return Ok(token),
            };
            let checked = |n: Option<u32>| -> Res<Option<u64>> {
                match n {
                    None | Some(0) => Ok(None),
                    Some(n @ (1 | 2 | 4 | 8 | 16)) => Ok(Some(u64::from(n))),
                    Some(_) => err(token.loc, "#pragma pack expects 1, 2, 4, 8 or 16"),
                }
            };
            match op {
                PackOp::Set(n) => self.pack = checked(n)?,
                PackOp::Push(n) => {
                    self.pack_stack.push(self.pack);
                    if n.is_some() {
                        self.pack = checked(n)?;
                    }
                }
                PackOp::Pop => {
                    if let Some(previous) = self.pack_stack.pop() {
                        self.pack = previous;
                    }
                }
            }
        }
    }

    /// Consumes the current token and returns it.
    fn bump(&mut self) -> Res<Token> {
        let next = match self.next.take() {
            Some(t) => t,
            None => self.fetch()?,
        };
        Ok(std::mem::replace(&mut self.cur, next))
    }

    /// The token after the current one.
    fn peek2(&mut self) -> Res<&Tok> {
        if self.next.is_none() {
            self.next = Some(self.fetch()?);
        }
        match &self.next {
            Some(t) => Ok(&t.tok),
            None => Ok(&Tok::Eof),
        }
    }

    fn loc(&self) -> Loc {
        self.cur.loc
    }

    fn at(&self, p: Punct) -> bool {
        self.cur.tok == Tok::Punct(p)
    }

    fn at_kw(&self, k: Kw) -> bool {
        self.cur.tok == Tok::Kw(k)
    }

    fn eat(&mut self, p: Punct) -> Res<bool> {
        if self.at(p) {
            self.bump()?;
            return Ok(true);
        }
        Ok(false)
    }

    fn eat_kw(&mut self, k: Kw) -> Res<bool> {
        if self.at_kw(k) {
            self.bump()?;
            return Ok(true);
        }
        Ok(false)
    }

    fn expect(&mut self, p: Punct) -> Res<Loc> {
        if self.at(p) {
            return Ok(self.bump()?.loc);
        }
        err(
            self.loc(),
            format!(
                "expected '{}' before {}",
                p.spelling(),
                self.cur.tok.describe()
            ),
        )
    }

    fn expect_ident(&mut self) -> Res<(Rc<str>, Loc)> {
        let loc = self.loc();
        match &self.cur.tok {
            Tok::Ident(name) => {
                let name = Rc::clone(name);
                self.bump()?;
                Ok((name, loc))
            }
            other => err(
                loc,
                format!("expected identifier before {}", other.describe()),
            ),
        }
    }

    fn enter(&mut self) -> Res<()> {
        self.nesting += 1;
        self.deepest_nesting = self.deepest_nesting.max(self.nesting);
        if self.nesting > MAX_NESTING || !self.sema.tcx.stack_check.is_safe_to_recurse() {
            return err(self.loc(), "the source is nested too deeply");
        }
        Ok(())
    }

    fn leave(&mut self) {
        self.nesting -= 1;
    }

    fn unsupported<T>(&self, what: &str) -> Res<T> {
        err(self.loc(), format!("{what} is not supported yet"))
    }

    // ───────────────────────────── translation unit ─────────────────────────────

    pub(crate) fn parse_program(mut self) -> Res<Program> {
        while self.cur.tok != Tok::Eof {
            if self.eat(Punct::Semi)? {
                continue;
            }
            self.parse_external_declaration()?;
        }
        let mut sema = self.sema;
        // The loader calls constructors and destructors as `void f(void)`. One that is
        // declared with parameters (or a result) gets a function of that shape in front of
        // it, which passes zeros.
        for id in 0..sema.funcs.len() {
            let f = &sema.funcs[id];
            let direct = f.ty.ret.is_void() && f.ty.params.is_empty() && !f.ty.variadic;
            if direct || f.body.is_none() || (f.constructor.is_none() && f.destructor.is_none()) {
                continue;
            }
            let (loc, nparams, name) = (f.loc, f.ty.params.len(), Rc::clone(&f.name));
            let (constructor, destructor) = (f.constructor, f.destructor);
            let callee = sema.function_ref(id as FuncId, loc)?;
            let mut args = Vec::with_capacity(nparams);
            for _ in 0..nparams {
                args.push(sema.int_lit(0, Type::Int, loc)?);
            }
            let call = sema.call(callee, args, loc)?;
            let call = sema.cast(call, &Type::Void, loc)?;
            let target = &mut sema.funcs[id];
            target.constructor = None;
            target.destructor = None;
            sema.funcs.push(Function {
                name: Rc::from(format!("{name}.initializer")),
                ty: Rc::new(FuncType {
                    ret: Type::Void,
                    params: Vec::new(),
                    variadic: false,
                    unprototyped: false,
                }),
                is_static: true,
                external: false,
                linkonce: false,
                link_name: None,
                inlining: 0,
                constructor,
                destructor,
                weak: None,
                param_names: Vec::new(),
                body: Some(FuncBody {
                    params: Vec::new(),
                    locals: Vec::new(),
                    stmts: vec![Stmt::Expr(call)],
                    nlabels: 0,
                    address_labels: Vec::new(),
                    label_vla_paths: Vec::new(),
                }),
                first_use: None,
                loc,
            });
        }
        let va_list_size = sema.va_list_size();
        let mut globals = sema.globals;
        for g in &mut globals {
            // `int a[];` with no later definition is a tentative definition of one element.
            if !g.defined {
                continue;
            }
            if let Type::Array(elem, None) = &g.ty {
                g.ty = Type::Array(Rc::clone(elem), Some(1));
            }
        }
        let warnings = sema.warnings.into_inner();
        let mut funcs = sema.funcs;
        // `#pragma weak name` applies wherever in the unit `name` is declared.
        for (name, loc) in &sema.pragma_weak {
            for f in funcs.iter_mut().filter(|f| f.name == *name) {
                f.weak.get_or_insert(*loc);
            }
            for g in globals.iter_mut().filter(|g| g.name == *name) {
                g.weak = true;
            }
        }
        // `#pragma redefine_extname name symbol`, likewise.
        for (name, symbol) in &sema.redefined_names {
            for f in funcs.iter_mut().filter(|f| f.name == *name) {
                f.link_name = Some(Rc::clone(symbol));
            }
            for g in globals.iter_mut().filter(|g| g.name == *name) {
                g.link_name = Some(Rc::clone(symbol));
            }
        }
        let sema_funcs = &funcs;
        for f in sema_funcs {
            if f.body.is_none() && f.is_static {
                if let Some(loc) = f.first_use {
                    return err(
                        loc,
                        format!("static function '{}' is used but never defined", f.name),
                    );
                }
            }
        }
        Ok(Program {
            va_list_size,
            tcx: sema.tcx,
            globals,
            funcs,
            strings: sema.strings,
            warnings,
            function_aliases: sema.function_aliases,
            asm_blocks: sema.asm_blocks,
        })
    }

    fn parse_static_assert(&mut self) -> Res<()> {
        let loc = self.bump()?.loc;
        self.expect(Punct::LParen)?;
        let cond = self.parse_conditional()?;
        let value = self.sema.const_int(&cond)?;
        let mut message = None;
        if self.eat(Punct::Comma)? {
            match self.bump()?.tok {
                Tok::Str(bytes, ..) => message = Some(crate::token::display_bytes(&bytes)),
                _ => return err(loc, "expected a string literal in _Static_assert"),
            }
        }
        self.expect(Punct::RParen)?;
        self.expect(Punct::Semi)?;
        if value == 0 {
            return err(
                loc,
                match message {
                    Some(m) => format!("static assertion failed: {m}"),
                    None => "static assertion failed".to_string(),
                },
            );
        }
        Ok(())
    }

    fn parse_external_declaration(&mut self) -> Res<()> {
        if self.at_kw(Kw::StaticAssert) {
            return self.parse_static_assert();
        }
        if self.at_kw(Kw::Asm) {
            return self.unsupported("inline assembly");
        }
        let spec = self.parse_declspec()?;
        if spec.is_register || spec.is_auto {
            return err(
                spec.loc,
                format!(
                    "a declaration outside a function cannot be '{}'",
                    if spec.is_register { "register" } else { "auto" }
                ),
            );
        }
        if self.eat(Punct::Semi)? {
            return Ok(());
        }
        self.star_bound = None;
        let mut first = true;
        loop {
            let decl = self.parse_declarator(spec.ty.clone())?;
            let Some(name) = decl.name.clone() else {
                return err(decl.loc, "expected an identifier in the declaration");
            };
            if spec.is_typedef {
                self.check_typedef_specifiers(&spec)?;
                self.mark_transparent_union(&decl, &spec);
                let align = match (decl.attrs.aligned, spec.attrs.aligned) {
                    (Some(a), Some(b)) => Some(a.max(b)),
                    (a, b) => a.or(b),
                };
                // On a typedef `aligned` sets the alignment, up or down.
                let ty = match align {
                    Some(a) if !decl.ty.is_func() => decl.ty.clone().with_alignment(a),
                    _ => decl.ty.clone(),
                };
                self.sema.declare_typedef(name, ty, decl.loc)?;
            } else if let Type::Func(fty) = &decl.ty {
                let old_style =
                    fty.unprototyped && decl.params.as_ref().is_some_and(|p| !p.is_empty());
                if first && (self.at(Punct::LBrace) || old_style && self.is_type_start()) {
                    let fty = Rc::clone(fty);
                    if old_style {
                        let (fty, decl) = self.parse_old_style_parameters(&name, &fty, decl)?;
                        self.parse_function_definition(&name, fty, decl, &spec)?;
                        if let Some(id) = self.sema.file_scope_function(&name) {
                            self.sema.old_style_functions.push(id);
                        }
                        return Ok(());
                    }
                    return self.parse_function_definition(&name, fty, decl, &spec);
                }
                if old_style {
                    return err(
                        decl.loc,
                        "a list of parameter names without types is only allowed in a function definition",
                    );
                }
                self.declare_function(name, Rc::clone(fty), &decl, &spec, false)?;
            } else {
                self.parse_global_variable(name, decl, &spec)?;
            }
            first = false;
            if !self.eat(Punct::Comma)? {
                break;
            }
        }
        self.expect(Punct::Semi)?;
        Ok(())
    }

    /// The declarations between `f(a, b)` and the body of an old-style definition. Callers
    /// pass promoted arguments (there is no prototype), so that is the function's type; the
    /// parameters themselves have the declared types.
    fn parse_old_style_parameters(
        &mut self,
        name: &str,
        fty: &Rc<FuncType>,
        mut decl: Declarator,
    ) -> Res<(Rc<FuncType>, Declarator)> {
        let mut params = decl.params.take().unwrap_or_default();
        // A prototype that is already in scope decides how the arguments are passed.
        let prototype = match self.sema.lookup(name) {
            Some(Symbol::Func(id)) => {
                let ty = &self.sema.funcs[*id as usize].ty;
                (!ty.unprototyped && !ty.variadic && ty.params.len() == params.len())
                    .then(|| Rc::clone(ty))
            }
            _ => None,
        };
        let mut declared_names: Vec<Rc<str>> = Vec::new();
        // Tags declared here belong to the function, not to the file.
        self.sema.push_scope();
        while !self.at(Punct::LBrace) {
            if self.cur.tok == Tok::Eof {
                return err(self.loc(), "expected a function body");
            }
            let spec = self.parse_declspec()?;
            if spec.is_typedef || matches!(spec.storage, Storage::Static | Storage::Extern) {
                return err(spec.loc, "invalid storage class for a parameter");
            }
            loop {
                let one = self.parse_declarator(spec.ty.clone())?;
                let Some(name) = one.name.clone() else {
                    return err(one.loc, "expected a parameter name");
                };
                let Some(param) = params.iter_mut().find(|p| p.name.as_ref() == Some(&name)) else {
                    return err(
                        one.loc,
                        format!("'{name}' is not a parameter of the function"),
                    );
                };
                let quals = one.ty.quals();
                let declared = match one.ty {
                    Type::Array(elem, _) | Type::Vla(elem, _) => Type::Ptr(elem),
                    Type::Func(_) => one.ty.ptr_to(),
                    Type::Void => return err(one.loc, "parameter has type void"),
                    other => other.unatomic().clone(),
                };
                param.ty = Sema::default_promoted_type(&declared);
                param.local_ty = declared.qualified(quals);
                param.is_register = spec.is_register;
                param.loc = one.loc;
                declared_names.push(name);
                if !self.eat(Punct::Comma)? {
                    break;
                }
            }
            self.expect(Punct::Semi)?;
        }
        self.sema.pop_scope();
        if let Some(missing) = params
            .iter()
            .find(|p| !p.name.as_ref().is_some_and(|n| declared_names.contains(n)))
        {
            return err(
                missing.loc,
                format!(
                    "parameter '{}' has no declaration (implicit int is not supported)",
                    missing.name.as_deref().unwrap_or_default()
                ),
            );
        }
        if let Some(prototype) = prototype {
            for (param, declared) in params.iter_mut().zip(&prototype.params) {
                if param.local_ty.unatomic() == declared {
                    param.ty.clone_from(declared);
                }
            }
        }
        let fty = Rc::new(FuncType {
            ret: fty.ret.clone(),
            params: params.iter().map(|p| p.ty.clone()).collect(),
            variadic: false,
            unprototyped: false,
        });
        decl.ty = Type::Func(Rc::clone(&fty));
        decl.params = Some(params);
        Ok((fty, decl))
    }

    /// An object is declared `static` every time or never (`extern` takes what came before).
    fn check_linkage_agrees(
        &self,
        id: GlobalId,
        name: &str,
        spec: &DeclSpec,
        first: bool,
        loc: Loc,
    ) -> Res<()> {
        if first {
            return Ok(());
        }
        let was_static = self.sema.globals[id as usize].is_static;
        match spec.storage {
            Storage::Static if !was_static => err(
                loc,
                format!("static declaration of '{name}' follows a non-static declaration"),
            ),
            Storage::None if was_static => err(
                loc,
                format!("non-static declaration of '{name}' follows a static declaration"),
            ),
            _ => Ok(()),
        }
    }

    fn check_typedef_specifiers(&self, spec: &DeclSpec) -> Res<()> {
        if let Some((_, at)) = spec.attrs.alignas {
            return err(at, "'_Alignas' cannot be applied to a typedef");
        }
        if spec.is_inline || spec.is_noreturn {
            return err(
                spec.loc,
                "a function specifier in the declaration of a typedef",
            );
        }
        Ok(())
    }

    /// What the declaration specifiers of an object may not say.
    fn check_object_specifiers(&self, spec: &DeclSpec, decl: &Declarator) -> Res<()> {
        if spec.is_inline || spec.is_noreturn {
            return err(
                decl.loc,
                "'inline' and '_Noreturn' can only be used in the declaration of a function",
            );
        }
        if let (Some((_, at)), true) = (spec.attrs.alignas, spec.is_register) {
            return err(at, "'_Alignas' cannot be applied to a register variable");
        }
        if let Some(tag) = &spec.incomplete_enum {
            let mut object = &decl.ty;
            while let Type::Array(elem, _) = object.unqualified() {
                object = elem;
            }
            if !object.is_ptr() && !object.is_func() && spec.storage != Storage::Extern {
                return err(
                    decl.loc,
                    format!("variable has incomplete type 'enum {tag}'"),
                );
            }
        }
        self.check_alignas(spec, &decl.ty)
    }

    /// `_Alignas` cannot ask for less than the type requires.
    /// No object is aligned to more than the loader's limit, so no alignment above it is
    /// taken anywhere one is written.
    fn check_alignment_limit(&self, bytes: u64, loc: Loc) -> Res<()> {
        if bytes > crate::bir::MAX_ALIGN {
            return err(
                loc,
                format!(
                    "alignments over {} bytes are not supported",
                    crate::bir::MAX_ALIGN
                ),
            );
        }
        Ok(())
    }

    fn check_alignas(&self, spec: &DeclSpec, ty: &Type) -> Res<()> {
        if let Some((requested, at)) = spec.attrs.alignas {
            if self
                .sema
                .tcx
                .align_of(ty)
                .is_some_and(|natural| requested < natural)
            {
                return err(
                    at,
                    format!(
                        "'_Alignas({requested})' is less than the alignment of '{}'",
                        self.sema.tcx.display(ty)
                    ),
                );
            }
        }
        Ok(())
    }

    /// `typedef union {...} name __attribute__((transparent_union));`
    fn mark_transparent_union(&mut self, decl: &Declarator, spec: &DeclSpec) {
        if decl.attrs.transparent_union || spec.attrs.transparent_union {
            if let Type::Struct(id) = decl.ty.unqualified() {
                let def = &mut self.sema.tcx.structs[*id as usize];
                def.transparent = def.is_union;
            }
        }
    }

    /// Declares (or redeclares) a function from a declaration or the head of a definition.
    fn declare_function(
        &mut self,
        name: Rc<str>,
        fty: Rc<FuncType>,
        decl: &Declarator,
        spec: &DeclSpec,
        is_definition: bool,
    ) -> Res<FuncId> {
        let is_static = spec.storage == Storage::Static;
        if spec.thread_local {
            return err(decl.loc, "a function cannot be thread-local");
        }
        if let Some((_, at)) = spec.attrs.alignas {
            return err(at, "'_Alignas' cannot be applied to a function");
        }
        if is_static && !is_definition && self.sema.func.is_some() {
            return err(
                decl.loc,
                "a function declared inside a block can be 'extern' but not 'static'",
            );
        }
        // Another name for a function of this unit: `alias("target")`, or an assembler name
        // that a function declared here already has. Uses of the new name are uses of it.
        if !is_definition {
            let alias = decl
                .attrs
                .alias
                .clone()
                .or_else(|| spec.attrs.alias.clone());
            let label = decl
                .attrs
                .asm_label
                .clone()
                .or_else(|| spec.attrs.asm_label.clone());
            let target = alias.as_ref().map(|(n, _)| n).or(label.as_ref());
            if let Some(target) = target.filter(|t| **t != name) {
                match self.sema.file_scope_function(target) {
                    Some(id) => {
                        self.sema.alias_function(name, id, is_static);
                        return Ok(id);
                    }
                    None => {
                        if let Some((target, aloc)) = alias {
                            return err(
                                aloc,
                                format!(
                                    "alias target '{target}' must be a function declared earlier in this translation unit"
                                ),
                            );
                        }
                    }
                }
            }
        }
        let id = self.sema.declare_func(name, fty, is_static, decl.loc)?;
        let f = &mut self.sema.funcs[id as usize];
        // Only `inline` on its own leaves the function without an external definition; with
        // `gnu_inline` it is `extern inline` that does, whatever other declarations say
        // (glibc defines `atof`, `vprintf`, ... like that in its headers).
        let gnu_inline = decl.attrs.gnu_inline || spec.attrs.gnu_inline;
        let inline_only = spec.is_inline && (spec.storage == Storage::Extern) == gnu_inline;
        if gnu_inline && inline_only && is_definition {
            f.inlining |= INLINE_ONLY_DEFINITION;
        }
        // Microsoft's `inline` is C++'s: every unit that uses the function has a definition of
        // its own, whatever other declarations say, and none is the program's one.
        if self.dialect.microsoft && spec.is_inline && is_definition {
            f.inlining |= INLINE_ONLY_DEFINITION;
            f.linkonce = !is_static;
        }
        if !inline_only {
            f.external = true;
        }
        if let Some(label) = decl
            .attrs
            .asm_label
            .clone()
            .or_else(|| spec.attrs.asm_label.clone())
        {
            f.link_name = Some(label);
        }
        if decl.attrs.weak || spec.attrs.weak {
            f.weak = Some(decl.loc);
        }
        if let Some(params) = &decl.params {
            if params.iter().any(|p| p.name.is_some()) || f.param_names.is_empty() {
                f.param_names = params.iter().map(|p| p.name.clone()).collect();
            }
        }
        f.inlining |= decl.attrs.inlining | spec.attrs.inlining;
        if spec.is_inline {
            f.inlining |= crate::bir::INLINE_HINT;
        }
        if f.inlining & crate::bir::INLINE_NEVER != 0 {
            f.inlining &= !crate::bir::INLINE_ALWAYS;
        }
        if f.inlining & INLINE_ONLY_DEFINITION != 0 {
            f.external = false;
        }
        let constructor = decl.attrs.constructor.or(spec.attrs.constructor);
        let destructor = decl.attrs.destructor.or(spec.attrs.destructor);
        if constructor.is_some() || destructor.is_some() {
            // glibc calls constructors with (argc, argv, envp); a loaded module has none, so
            // such a function is called with zeros (see `parse_program`).
            let plain = |ty: &Type| ty.is_value() && !ty.is_vector();
            if !(f.ty.ret.is_void() || plain(&f.ty.ret)) || !f.ty.params.iter().all(plain) {
                let what = if constructor.is_some() {
                    "constructor"
                } else {
                    "destructor"
                };
                return err(
                    decl.loc,
                    format!("a {what} must take and return scalars, as in 'void f(void)'"),
                );
            }
            f.constructor = constructor.or(f.constructor);
            f.destructor = destructor.or(f.destructor);
        }
        Ok(id)
    }

    fn parse_global_variable(
        &mut self,
        name: Rc<str>,
        decl: Declarator,
        spec: &DeclSpec,
    ) -> Res<()> {
        let has_init = self.at(Punct::Assign);
        let is_definition = spec.storage != Storage::Extern || has_init;
        if decl.ty.is_void() {
            return err(decl.loc, format!("variable '{name}' has type void"));
        }
        self.check_object_specifiers(spec, &decl)?;
        let first = !self.sema.is_file_scope_object(&name);
        let align = match (decl.attrs.aligned, spec.attrs.aligned) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        let link_name = decl.attrs.asm_label.clone();
        if !has_init {
            let alias = decl
                .attrs
                .alias
                .clone()
                .or_else(|| spec.attrs.alias.clone());
            let target = alias.as_ref().map(|(n, _)| n).or(link_name.as_ref());
            if let Some(target) = target.filter(|t| **t != name) {
                match self.sema.file_scope_object(target) {
                    Some(id) => {
                        self.sema.alias_object(name, id);
                        return Ok(());
                    }
                    None => {
                        if let Some((target, aloc)) = alias {
                            return err(
                                aloc,
                                format!(
                                    "alias target '{target}' must be an object declared earlier in this translation unit"
                                ),
                            );
                        }
                    }
                }
            }
            if is_definition
                && !self.sema.tcx.is_complete(&decl.ty)
                && !matches!(decl.ty, Type::Array(_, None))
            {
                return err(
                    decl.loc,
                    format!(
                        "variable '{name}' has incomplete type '{}'",
                        self.sema.tcx.display(&decl.ty)
                    ),
                );
            }
            self.check_object_size(&decl.ty, decl.loc)?;
            let id =
                self.sema
                    .declare_global(Rc::clone(&name), decl.ty, is_definition, decl.loc)?;
            self.sema.set_global_attrs(id, align, link_name);
            self.sema.globals[id as usize].weak |= decl.attrs.weak || spec.attrs.weak;
            self.sema.globals[id as usize].linkonce |= decl.attrs.selectany || spec.attrs.selectany;
            self.check_linkage_agrees(id, &name, spec, first, decl.loc)?;
            self.sema.globals[id as usize].is_static |= spec.storage == Storage::Static;
            self.sema.set_thread_local(
                id,
                spec.thread_local,
                crate::sema::Declared::first_time(first),
                decl.loc,
            )?;
            return Ok(());
        }
        let id = self
            .sema
            .declare_global(Rc::clone(&name), decl.ty.clone(), true, decl.loc)?;
        self.sema.set_global_attrs(id, align, link_name);
        self.sema.globals[id as usize].weak |= decl.attrs.weak || spec.attrs.weak;
        self.sema.globals[id as usize].linkonce |= decl.attrs.selectany || spec.attrs.selectany;
        self.check_linkage_agrees(id, &name, spec, first, decl.loc)?;
        self.sema.globals[id as usize].is_static |= spec.storage == Storage::Static;
        self.sema.set_thread_local(
            id,
            spec.thread_local,
            crate::sema::Declared::first_time(first),
            decl.loc,
        )?;
        self.bump()?;
        let init = self.parse_initializer()?;
        let declared_ty = self.sema.globals[id as usize].ty.clone();
        let (ty, items) = self.sema.elaborate_init(&declared_ty, init, decl.loc)?;
        let (bytes, relocs) =
            self.sema
                .static_init_data(&ty, &items, spec.thread_local, decl.loc)?;
        let extra_size = self.sema.flexible_extra(&ty);
        let g = &mut self.sema.globals[id as usize];
        if g.has_initializer {
            return err(decl.loc, format!("redefinition of '{name}'"));
        }
        g.extra_size = extra_size;
        g.ty = ty;
        g.init = bytes;
        g.relocs = relocs;
        g.has_initializer = true;
        Ok(())
    }

    fn check_object_size(&self, ty: &Type, loc: Loc) -> Res<()> {
        if self
            .sema
            .tcx
            .size_of(ty)
            .is_some_and(|s| s > MAX_OBJECT_SIZE)
        {
            return err(loc, "object is too large");
        }
        Ok(())
    }

    fn parse_function_definition(
        &mut self,
        name: &Rc<str>,
        fty: Rc<FuncType>,
        decl: Declarator,
        spec: &DeclSpec,
    ) -> Res<()> {
        let loc = decl.loc;
        if decl.params.is_none() {
            return err(
                loc,
                "the declarator of a function definition must have a parameter list of its own",
            );
        }
        if let Some(star) = self.star_bound.take() {
            return err(
                star,
                "'[*]' is only allowed in a declaration that is not a function definition",
            );
        }
        if fty.ret.is_struct() && !self.sema.tcx.is_complete(&fty.ret) {
            return err(loc, "function returns an incomplete type");
        }
        // A function that takes or returns a long double is only a problem if it is compiled:
        // headers are full of `static inline` ones nobody calls (see `gen_function`).
        let wide_ret = matches!(fty.ret, Type::Wide(_));
        if !wide_ret
            && !fty.ret.is_void()
            && !fty.ret.is_value()
            && !fty.ret.is_struct()
            && !fty.ret.is_pair()
        {
            return err(loc, "function has an invalid return type");
        }
        // A definition `int f() { ... }` has no parameters.
        let fty = if fty.unprototyped {
            Rc::new(FuncType {
                unprototyped: false,
                ..(*fty).clone()
            })
        } else {
            fty
        };
        let id = self.declare_function(Rc::clone(name), Rc::clone(&fty), &decl, spec, true)?;
        if self.sema.funcs[id as usize].body.is_some() {
            return err_with_note(
                loc,
                format!("redefinition of '{name}'"),
                self.sema.funcs[id as usize].loc,
                "the previous declaration is here",
            );
        }
        self.sema.funcs[id as usize].ty = Rc::clone(&fty);

        self.sema.func = Some(FnCtx {
            name: Rc::clone(name),
            ret: fty.ret.clone(),
            locals: Vec::new(),
            labels: BTreeMap::new(),
            nlabels: 0,
            nstatics: 0,
            shared_statics: self.dialect.microsoft
                && spec.is_inline
                && spec.storage != Storage::Static,
            variadic: fty.variadic,
            address_labels: Vec::new(),
            label_vla_paths: BTreeMap::new(),
            nvla_scopes: 0,
            local_labels: Vec::new(),
            nlocal_labels: 0,
        });
        self.sema.push_scope();
        self.pending_vla.clear();
        self.gotos.clear();
        self.computed_goto = None;
        self.deepest_nesting = self.nesting;
        self.sema.deepest_expr.set(0);
        let mut params = Vec::new();
        for p in decl.params.unwrap_or_default() {
            let id = match p.name {
                Some(pname) => self.sema.declare_local(pname, p.local_ty, p.loc)?,
                None => self.sema.new_local(p.local_ty),
            };
            if p.is_register {
                self.sema.set_local_register(id);
            }
            params.push(id);
        }
        // `int m[n][n]` parameters: their bounds are evaluated on entry.
        let mut stmts = Vec::new();
        for param in &fty.params {
            self.sema.bind_param_vlas(param, &mut stmts, loc)?;
        }
        self.expect(Punct::LBrace)?;
        stmts.extend(self.parse_block_items()?);
        self.sema.pop_scope();
        let Some(ctx) = self.sema.func.take() else {
            return err(loc, "internal error: function context lost");
        };
        for (label, info) in &ctx.labels {
            if !info.defined {
                return err(info.loc, format!("use of undeclared label '{label}'"));
            }
        }
        let mut label_vla_paths = vec![Vec::new(); ctx.nlabels as usize];
        for (label, path) in ctx.label_vla_paths {
            if let Some(slot) = label_vla_paths.get_mut(label as usize) {
                *slot = path;
            }
        }
        // Jumping forward past a variable length array declaration, into its scope, is a
        // constraint violation (C11 6.8.6.1).
        for (label, from, goto_loc) in std::mem::take(&mut self.gotos) {
            let target = &label_vla_paths[label as usize];
            if !from.starts_with(target) {
                return err(goto_loc, "goto into the scope of a variable length array");
            }
        }
        if let Some(goto_loc) = self.computed_goto.take() {
            let inside = ctx
                .address_labels
                .iter()
                .any(|&label| !label_vla_paths[label as usize].is_empty());
            if inside {
                return err(
                    goto_loc,
                    "a computed goto cannot target a label in the scope of a variable length array",
                );
            }
        }
        let body = FuncBody {
            params,
            locals: ctx.locals,
            stmts,
            nlabels: ctx.nlabels,
            address_labels: ctx.address_labels,
            label_vla_paths,
        };
        // What follows walks the body recursively, some of it (the copies and the destructor the
        // compiler derives among it) with no way to stop half way: the room for the deepest walk
        // is asked for here, once.
        let levels = (self.deepest_nesting - self.nesting + self.sema.deepest_expr.get()) as usize;
        if !self
            .sema
            .tcx
            .stack_check
            .is_safe_to_recurse_with_extra(levels * STACK_PER_LEVEL)
        {
            return err(loc, format!("the body of '{name}' is nested too deeply"));
        }
        self.sema.funcs[id as usize].body = Some(body);
        Ok(())
    }

    // ───────────────────────────── declaration specifiers ─────────────────────────────

    fn is_type_start(&self) -> bool {
        match &self.cur.tok {
            Tok::Kw(k) => matches!(
                k,
                Kw::Alignas
                    | Kw::Atomic
                    | Kw::Attribute
                    | Kw::Auto
                    | Kw::Bool
                    | Kw::Char
                    | Kw::Complex
                    | Kw::Const
                    | Kw::Double
                    | Kw::Enum
                    | Kw::Extension
                    | Kw::Extern
                    | Kw::Float
                    | Kw::Inline
                    | Kw::ForceInline
                    | Kw::Int
                    | Kw::Int128
                    | Kw::Int64
                    | Kw::Long
                    | Kw::Noreturn
                    | Kw::Register
                    | Kw::Restrict
                    | Kw::Short
                    | Kw::Signed
                    | Kw::Static
                    | Kw::Struct
                    | Kw::ThreadLocal
                    | Kw::Typedef
                    | Kw::Typeof
                    | Kw::TypeofUnqual
                    | Kw::Union
                    | Kw::Unsigned
                    | Kw::Void
                    | Kw::Volatile
            ),
            Tok::Ident(name) => self.sema.is_typedef_name(name),
            _ => false,
        }
    }

    /// Whether the token after the current one starts a type name (for `(type)` and `sizeof(type)`).
    fn next_is_type_start(&mut self) -> Res<bool> {
        let next = self.peek2()?.clone();
        Ok(match next {
            Tok::Kw(k) => matches!(
                k,
                Kw::Atomic
                    | Kw::Attribute
                    | Kw::Bool
                    | Kw::Char
                    | Kw::Complex
                    | Kw::Const
                    | Kw::Double
                    | Kw::Enum
                    | Kw::Float
                    | Kw::Int
                    | Kw::Int128
                    | Kw::Int64
                    | Kw::Long
                    | Kw::Restrict
                    | Kw::Short
                    | Kw::Signed
                    | Kw::Struct
                    | Kw::Typeof
                    | Kw::TypeofUnqual
                    | Kw::Union
                    | Kw::Unsigned
                    | Kw::Void
                    | Kw::Volatile
            ),
            Tok::Ident(name) => self.sema.is_typedef_name(&name),
            _ => false,
        })
    }

    /// Parses any run of `__attribute__((...))`, `__declspec(...)`, `[[...]]` and asm labels:
    /// what `IMPLEMENTED_ATTRIBUTES` lists is recorded in `attrs` or refused, what
    /// `IGNORED_ATTRIBUTES` lists is skipped, anything else is skipped with a warning.
    fn parse_attributes(&mut self, attrs: &mut Attrs) -> Res<()> {
        loop {
            if self.at_kw(Kw::Attribute) {
                self.bump()?;
                self.expect(Punct::LParen)?;
                let double = self.eat(Punct::LParen)?;
                self.parse_attribute_list(attrs, Punct::RParen)?;
                if double {
                    self.expect(Punct::RParen)?;
                }
                self.expect(Punct::RParen)?;
            } else if self.at(Punct::LBracket)
                && matches!(self.peek2()?, Tok::Punct(Punct::LBracket))
            {
                // `[[name]]`, `[[vendor::name(arguments)]]`: the vendors whose attributes these are
                // mean by them what `__attribute__` means.
                self.bump()?;
                self.bump()?;
                self.parse_attribute_list(attrs, Punct::RBracket)?;
                self.expect(Punct::RBracket)?;
                self.expect(Punct::RBracket)?;
            } else if self.at_kw(Kw::Asm) && matches!(self.peek2()?, Tok::Punct(Punct::LParen)) {
                let loc = self.bump()?.loc;
                self.bump()?;
                let mut label = Vec::new();
                while let Tok::Str(part, ..) = &self.cur.tok {
                    label.extend_from_slice(part);
                    self.bump()?;
                }
                if label.is_empty() || !self.at(Punct::RParen) {
                    return err(loc, "inline assembly is not supported yet");
                }
                self.bump()?;
                match std::str::from_utf8(&label) {
                    // A label is the assembler's name for the symbol; everywhere else (what the
                    // loader looks up) it goes by its C name, which on Mach-O lacks the leading `_`.
                    Ok(name) if self.sema.tcx.target.os == crate::types::Os::MacOs => {
                        attrs.asm_label = Some(Rc::from(name.strip_prefix('_').unwrap_or(name)));
                    }
                    Ok(name) => attrs.asm_label = Some(Rc::from(name)),
                    Err(_) => return err(loc, "asm label is not valid UTF-8"),
                }
            } else {
                return Ok(());
            }
        }
    }

    /// The comma-separated items inside `__attribute__((` ... `))` or `[[` ... `]]`, up to `close`.
    fn parse_attribute_list(&mut self, attrs: &mut Attrs, close: Punct) -> Res<()> {
        while !self.at(close) {
            if self.cur.tok == Tok::Eof {
                return err(self.loc(), "unterminated attribute list");
            }
            if self.eat(Punct::Comma)? {
                continue;
            }
            let name: Option<Rc<str>> = match &self.cur.tok {
                Tok::Ident(n) => Some(Rc::clone(n)),
                _ => None,
            };
            self.bump()?;
            let strip = |name: &str| -> Rc<str> {
                Rc::from(
                    name.strip_prefix("__")
                        .and_then(|n| n.strip_suffix("__"))
                        .unwrap_or(name),
                )
            };
            let mut name = strip(name.as_deref().unwrap_or(""));
            // `vendor::name`: another vendor's attribute is nobody's here.
            if self.at(Punct::Colon) && matches!(self.peek2()?, Tok::Punct(Punct::Colon)) {
                self.bump()?;
                self.bump()?;
                let vendor = name;
                name = match &self.cur.tok {
                    Tok::Ident(n) => strip(n),
                    _ => Rc::from(""),
                };
                self.bump()?;
                if !matches!(&*vendor, "gnu" | "clang" | "msvc") {
                    if self.at(Punct::LParen) {
                        self.bump()?;
                        self.skip_balanced(Punct::LParen, Punct::RParen)?;
                    }
                    continue;
                }
            }
            let name = &*name;
            let has_args = self.at(Punct::LParen);
            match name {
                "aligned" | "align" => {
                    let mut value = 16;
                    if has_args {
                        self.bump()?;
                        let e = self.parse_conditional()?;
                        value = self.sema.const_int(&e)?;
                        self.expect(Punct::RParen)?;
                    }
                    if value <= 0 || !(value as u64).is_power_of_two() {
                        return err(
                            self.loc(),
                            "requested alignment is not a positive power of two",
                        );
                    }
                    self.check_alignment_limit(value as u64, self.loc())?;
                    attrs.aligned = Some(attrs.aligned.unwrap_or(1).max(value as u64));
                    if name == "align" {
                        attrs.declspec_align =
                            Some(attrs.declspec_align.unwrap_or(1).max(value as u64));
                    }
                }
                "packed" => attrs.packed = true,
                "weak" => attrs.weak = true,
                // Microsoft's: thread storage, and a definition that any number of units may
                // have, of which the program keeps one.
                "thread" => attrs.thread = true,
                "selectany" => attrs.selectany = true,
                "gnu_inline" => attrs.gnu_inline = true,
                "always_inline" => attrs.inlining |= crate::bir::INLINE_ALWAYS,
                "noinline" => attrs.inlining |= crate::bir::INLINE_NEVER,
                "cleanup" | "mode" if has_args => {
                    let aloc = self.bump()?.loc;
                    let argument = match &self.cur.tok {
                        Tok::Ident(n) => Rc::clone(n),
                        // `mode(byte)` and friends are never keywords; `cleanup(f)` names a function.
                        _ => return err(aloc, format!("{name} expects an identifier")),
                    };
                    self.bump()?;
                    self.expect(Punct::RParen)?;
                    if name == "cleanup" {
                        attrs.cleanup = Some((argument, aloc));
                    } else {
                        attrs.mode = Some((argument, aloc));
                    }
                }
                "alias" | "weakref" if has_args => {
                    let aloc = self.bump()?.loc;
                    let mut target = Vec::new();
                    while let Tok::Str(part, ..) = &self.cur.tok {
                        target.extend_from_slice(part);
                        self.bump()?;
                    }
                    self.expect(Punct::RParen)?;
                    match std::str::from_utf8(&target) {
                        Ok(target) if !target.is_empty() => {
                            attrs.alias = Some((Rc::from(target), aloc));
                        }
                        _ => return err(aloc, format!("{name} expects the name of a symbol")),
                    }
                }
                "constructor" | "destructor" => {
                    let mut priority = 65535;
                    if has_args {
                        self.bump()?;
                        if !self.at(Punct::RParen) {
                            let e = self.parse_conditional()?;
                            let value = self.sema.const_int(&e)?;
                            if !(0..=65535).contains(&value) {
                                return err(
                                    self.loc(),
                                    format!("{name} priority must be 0 to 65535"),
                                );
                            }
                            priority = value as u32;
                        }
                        self.expect(Punct::RParen)?;
                    }
                    if name == "constructor" {
                        attrs.constructor = Some(priority);
                    } else {
                        attrs.destructor = Some(priority);
                    }
                }
                "vector_size" | "ext_vector_type" if has_args => {
                    let aloc = self.bump()?.loc;
                    let e = self.parse_conditional()?;
                    let value = self.sema.const_int(&e)?;
                    self.expect(Punct::RParen)?;
                    if name == "vector_size" {
                        attrs.vector_bytes = Some((value, aloc));
                    } else {
                        attrs.vector_count = Some((value, aloc));
                    }
                }
                // These change the layout, the calling convention or the meaning of the code
                // and are not implemented: accepting them silently would miscompile.
                "transparent_union" => attrs.transparent_union = true,
                "ms_struct" => attrs.ms_struct = Some(true),
                "gcc_struct" => attrs.ms_struct = Some(false),
                "scalar_storage_order"
                | "naked"
                | "vectorcall"
                | "regcall"
                | "pcs"
                | "interrupt"
                | "ifunc"
                | "overloadable"
                | "address_space"
                | "btf_type_tag"
                | "section_type" => {
                    return err(
                        self.loc(),
                        format!(
                            "__attribute__(({name})) is not supported: it changes how the code must be compiled"
                        ),
                    );
                }
                // The other convention of x86-64. (`stdcall`, `fastcall`, `thiscall`, `regparm`
                // and `cdecl` only mean something on 32-bit x86, which is not a target.)
                "sysv_abi" | "ms_abi"
                    if (name == "sysv_abi")
                        == (self.sema.tcx.target.os == crate::types::Os::Windows) =>
                {
                    return err(
                        self.loc(),
                        format!(
                            "__attribute__(({name})) is not supported on this target: it changes the calling convention"
                        ),
                    );
                }
                _ => {
                    // Everything else says something about the code without changing what it
                    // means (format, nonnull, pure, noinline, visibility, section, ...).
                    if !IGNORED_ATTRIBUTES.contains(&name) && !name.is_empty() {
                        let text = format!("unknown attribute '{name}' ignored");
                        let seen = self
                            .sema
                            .warnings
                            .borrow()
                            .iter()
                            .any(|(_, message)| *message == text);
                        if !seen {
                            self.sema.warnings.borrow_mut().push((self.loc(), text));
                        }
                    }
                    if has_args {
                        self.bump()?;
                        self.skip_balanced(Punct::LParen, Punct::RParen)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Skips tokens up to and including the `close` that matches an already consumed `open`.
    fn skip_balanced(&mut self, open: Punct, close: Punct) -> Res<()> {
        let mut depth = 1u32;
        loop {
            if self.cur.tok == Tok::Eof {
                return err(self.loc(), format!("expected '{}'", close.spelling()));
            }
            if self.at(open) {
                depth += 1;
            } else if self.at(close) {
                depth -= 1;
                if depth == 0 {
                    self.bump()?;
                    return Ok(());
                }
            }
            self.bump()?;
        }
    }

    fn parse_declspec(&mut self) -> Res<DeclSpec> {
        self.enter()?;
        self.incomplete_enum = None;
        let loc = self.loc();
        let mut storage = Storage::None;
        let mut is_typedef = false;
        let mut is_inline = false;
        let mut is_register = false;
        let mut is_auto = false;
        let mut is_noreturn = false;
        let mut restrict: Option<Loc> = None;
        let mut thread_local = false;
        let mut quals = Quals::NONE;
        let mut attrs = self.leading_attrs.take().unwrap_or_default();
        // Counts of the arithmetic type keywords seen.
        let (mut void, mut bool_, mut char_, mut short, mut int, mut long) =
            (0u32, 0u32, 0u32, 0u32, 0u32, 0u32);
        let (mut float, mut double, mut signed, mut unsigned) = (0u32, 0u32, 0u32, 0u32);
        let (mut complex, mut int128) = (0u32, 0u32);
        let mut other: Option<Type> = None;
        let mut any = false;
        let mut atomic: Option<Loc> = None;
        loop {
            let tloc = self.loc();
            let other_storage_class = is_register || is_auto;
            let set_storage = |storage: &mut Storage, is_typedef: bool, new: Storage| -> Res<()> {
                if *storage != Storage::None || is_typedef || other_storage_class {
                    return err(tloc, "multiple storage classes in declaration specifiers");
                }
                *storage = new;
                Ok(())
            };
            let seen_type = other.is_some()
                || void
                    + bool_
                    + char_
                    + short
                    + int
                    + long
                    + float
                    + double
                    + signed
                    + unsigned
                    + complex
                    + int128
                    > 0;
            match &self.cur.tok {
                Tok::Kw(k) => match k {
                    Kw::Typedef => {
                        if storage != Storage::None || is_typedef || is_register || is_auto {
                            return err(tloc, "multiple storage classes in declaration specifiers");
                        }
                        is_typedef = true;
                    }
                    Kw::Static => set_storage(&mut storage, is_typedef, Storage::Static)?,
                    Kw::Extern => set_storage(&mut storage, is_typedef, Storage::Extern)?,
                    Kw::Inline => is_inline = true,
                    Kw::ForceInline => {
                        is_inline = true;
                        attrs.inlining |= crate::bir::INLINE_ALWAYS;
                    }
                    Kw::ThreadLocal => thread_local = true,
                    Kw::Register | Kw::Auto => {
                        if storage != Storage::None || is_typedef || is_register || is_auto {
                            return err(tloc, "multiple storage classes in declaration specifiers");
                        }
                        if *k == Kw::Register {
                            is_register = true;
                        } else {
                            is_auto = true;
                        }
                    }
                    Kw::Noreturn => is_noreturn = true,
                    Kw::Extension => {}
                    Kw::Volatile => quals = quals.with(Quals::VOLATILE),
                    Kw::Const => quals = quals.with(Quals::CONST),
                    Kw::Restrict => restrict = Some(tloc),
                    Kw::Void => void += 1,
                    Kw::Bool => bool_ += 1,
                    Kw::Char => char_ += 1,
                    Kw::Short => short += 1,
                    Kw::Int => int += 1,
                    Kw::Long => long += 1,
                    Kw::Int64 => long += 2,
                    Kw::Float => float += 1,
                    Kw::Double => double += 1,
                    Kw::Signed => signed += 1,
                    Kw::Unsigned => unsigned += 1,
                    Kw::Complex => complex += 1,
                    Kw::Int128 => int128 += 1,
                    Kw::Struct | Kw::Union => {
                        if seen_type {
                            return err(tloc, "two or more data types in declaration specifiers");
                        }
                        let ahead = attrs.declspec_align.take();
                        self.declspec_struct_align = ahead;
                        other = Some(self.parse_struct_specifier()?);
                        // A definition took it; anything else leaves it to the declaration.
                        match self.declspec_struct_align.take() {
                            Some(unused) => attrs.declspec_align = Some(unused),
                            None if ahead.is_some() && attrs.aligned == ahead => {
                                attrs.aligned = None;
                            }
                            None => {}
                        }
                        any = true;
                        continue;
                    }
                    Kw::Enum => {
                        if seen_type {
                            return err(tloc, "two or more data types in declaration specifiers");
                        }
                        other = Some(self.parse_enum_specifier()?);
                        any = true;
                        continue;
                    }
                    Kw::Typeof | Kw::TypeofUnqual => {
                        if seen_type {
                            return err(tloc, "two or more data types in declaration specifiers");
                        }
                        let unqualified = *k == Kw::TypeofUnqual;
                        self.bump()?;
                        self.expect(Punct::LParen)?;
                        let ty = if self.is_type_start() {
                            self.parse_type_name()?
                        } else {
                            self.parse_expr()?.ty
                        };
                        self.expect(Punct::RParen)?;
                        other = Some(if unqualified {
                            ty.unqualified().unatomic().clone()
                        } else {
                            ty
                        });
                        any = true;
                        continue;
                    }
                    Kw::Alignas => {
                        self.bump()?;
                        self.expect(Punct::LParen)?;
                        let value = if self.is_type_start() {
                            let ty = self.parse_type_name()?;
                            match self.sema.tcx.align_of(&ty) {
                                Some(a) => a as i64,
                                None => return err(tloc, "_Alignas of an incomplete type"),
                            }
                        } else {
                            let e = self.parse_conditional()?;
                            self.sema.const_int(&e)?
                        };
                        self.expect(Punct::RParen)?;
                        if value < 0 || (value > 0 && !(value as u64).is_power_of_two()) {
                            return err(tloc, "requested alignment is not a power of two");
                        }
                        self.check_alignment_limit(value as u64, tloc)?;
                        if value > 0 {
                            attrs.aligned = Some(attrs.aligned.unwrap_or(1).max(value as u64));
                            let most = attrs.alignas.map_or(0, |(most, _)| most).max(value as u64);
                            attrs.alignas = Some((most, tloc));
                        }
                        any = true;
                        continue;
                    }
                    Kw::Attribute => {
                        self.parse_attributes(&mut attrs)?;
                        any = true;
                        continue;
                    }
                    Kw::Atomic => {
                        if !matches!(self.peek2()?, Tok::Punct(Punct::LParen)) {
                            atomic = Some(tloc);
                        } else {
                            if seen_type {
                                return err(
                                    tloc,
                                    "two or more data types in declaration specifiers",
                                );
                            }
                            self.bump()?;
                            self.bump()?;
                            let ty = self.parse_type_name()?;
                            self.expect(Punct::RParen)?;
                            if ty.is_atomic() || !ty.quals().is_empty() {
                                return err(
                                    tloc,
                                    format!(
                                        "_Atomic( ) cannot name the atomic or qualified type '{}'",
                                        self.sema.tcx.display(&ty)
                                    ),
                                );
                            }
                            other = Some(self.sema.atomic_of(ty, tloc)?);
                            any = true;
                            continue;
                        }
                    }
                    _ => break,
                },
                Tok::Punct(Punct::LBracket) => {
                    if !matches!(self.peek2()?, Tok::Punct(Punct::LBracket)) {
                        break;
                    }
                    self.parse_attributes(&mut attrs)?;
                    continue;
                }
                Tok::Ident(name) => {
                    // A typedef name is only a type specifier if no other specifier was seen:
                    // in `typedef int T; unsigned T;` the second T is a declarator.
                    // (`_Complex _Float128`: the floating type names that are keywords to
                    // GCC may follow `_Complex`.)
                    let after_complex = other.is_none()
                        && complex == 1
                        && void
                            + bool_
                            + char_
                            + short
                            + int
                            + long
                            + float
                            + double
                            + signed
                            + unsigned
                            + int128
                            == 0
                        && matches!(
                            &**name,
                            "_Float32"
                                | "_Float64"
                                | "_Float32x"
                                | "_Float64x"
                                | "_Float128"
                                | "__float128"
                        );
                    if seen_type && !after_complex {
                        break;
                    }
                    match self.sema.lookup(name) {
                        Some(crate::sema::Symbol::Typedef(ty)) => other = Some(ty.clone()),
                        _ => break,
                    }
                }
                _ => break,
            }
            any = true;
            self.bump()?;
        }
        if !any {
            return err(
                loc,
                format!("expected a type before {}", self.cur.tok.describe()),
            );
        }
        let arith = void
            + bool_
            + char_
            + short
            + int
            + long
            + float
            + double
            + signed
            + unsigned
            + complex
            + int128;
        let ty = if let Some(ty) = other {
            // `_Complex _Float128` and the like: the builtin names act as keywords.
            let complex_of = match ty {
                Type::Float => Some(Type::ComplexFloat),
                Type::Double => Some(Type::ComplexDouble),
                Type::Wide(WideKind::LongDouble | WideKind::QuadLongDouble) => {
                    Some(Type::Wide(WideKind::ComplexLongDouble))
                }
                Type::Wide(WideKind::Float128) => Some(Type::Wide(WideKind::ComplexFloat128)),
                _ => None,
            };
            match complex_of {
                Some(complex_ty) if complex == 1 && arith == 1 => complex_ty,
                _ if arith > 0 => {
                    return err(loc, "two or more data types in declaration specifiers");
                }
                _ => ty,
            }
        } else {
            if signed > 0 && unsigned > 0 {
                return err(
                    loc,
                    "both 'signed' and 'unsigned' in declaration specifiers",
                );
            }
            let sign = signed + unsigned;
            let uns = unsigned > 0;
            let long_double = || self.sema.tcx.target.long_double_type();
            match (
                void, bool_, char_, short, int, long, float, double, complex, int128,
            ) {
                (1, 0, 0, 0, 0, 0, 0, 0, 0, 0) if sign == 0 => Type::Void,
                (0, 1, 0, 0, 0, 0, 0, 0, 0, 0) if sign == 0 => Type::Bool,
                (0, 0, 1, 0, 0, 0, 0, 0, 0, 0) => {
                    if uns {
                        Type::UChar
                    } else if signed > 0 {
                        Type::SChar
                    } else {
                        Type::Char
                    }
                }
                (0, 0, 0, 1, 0 | 1, 0, 0, 0, 0, 0) => {
                    if uns {
                        Type::UShort
                    } else {
                        Type::Short
                    }
                }
                (0, 0, 0, 0, 0 | 1, 0, 0, 0, 0, 0) if int == 1 || sign == 1 => {
                    if uns {
                        Type::UInt
                    } else {
                        Type::Int
                    }
                }
                (0, 0, 0, 0, 0 | 1, 1, 0, 0, 0, 0) => {
                    if uns {
                        Type::ULong
                    } else {
                        Type::Long
                    }
                }
                (0, 0, 0, 0, 0 | 1, 2, 0, 0, 0, 0) => {
                    if uns {
                        Type::ULLong
                    } else {
                        Type::LLong
                    }
                }
                (0, 0, 0, 0, 0, 0, 0, 0, 0, 1) => {
                    if uns {
                        Type::UInt128
                    } else {
                        Type::Int128
                    }
                }
                (0, 0, 0, 0, 0, 0, 1, 0, 0, 0) if sign == 0 => Type::Float,
                (0, 0, 0, 0, 0, 0, 0, 1, 0, 0) if sign == 0 => Type::Double,
                (0, 0, 0, 0, 0, 1, 0, 1, 0, 0) if sign == 0 => long_double(),
                (0, 0, 0, 0, 0, 0, 1, 0, 1, 0) if sign == 0 => Type::ComplexFloat,
                (0, 0, 0, 0, 0, 0, 0, 0 | 1, 1, 0) if sign == 0 => Type::ComplexDouble,
                (0, 0, 0, 0, 0, 1, 0, 1, 1, 0) if sign == 0 => {
                    match self.sema.tcx.target.long_double_size() {
                        Some(_) => Type::Wide(WideKind::ComplexLongDouble),
                        None => Type::ComplexDouble,
                    }
                }
                (0, 0, 0, 0, 0, 0, 0, 0, 0, 0) if sign == 0 => {
                    return err(
                        loc,
                        "a type specifier is required (implicit int is not supported)",
                    );
                }
                _ => return err(loc, "invalid combination of type specifiers"),
            }
        };
        let ty = self.apply_vector_attrs(ty, &mut attrs)?;
        let ty = match atomic {
            Some(aloc) => self.sema.atomic_of(ty, aloc)?,
            None => ty,
        };
        if let Some(at) = restrict {
            if !ty.pointee().is_some_and(|pointee| !pointee.is_func()) {
                return err(at, "'restrict' qualifies only pointers to object types");
            }
        }
        let ty = ty.qualified(quals);
        self.leave();
        Ok(DeclSpec {
            ty,
            storage,
            is_register,
            is_auto,
            is_typedef,
            is_inline,
            is_noreturn,
            incomplete_enum: self.incomplete_enum.take(),
            thread_local: thread_local || attrs.thread,
            attrs,
            loc,
        })
    }

    fn parse_struct_specifier(&mut self) -> Res<Type> {
        let is_union = self.at_kw(Kw::Union);
        let kw_loc = self.bump()?.loc;
        let mut struct_attrs = Attrs::default();
        self.parse_attributes(&mut struct_attrs)?;
        let tag = match &self.cur.tok {
            Tok::Ident(name) => {
                let name = Rc::clone(name);
                self.bump()?;
                Some(name)
            }
            _ => None,
        };
        let kind = if is_union { "union" } else { "struct" };
        if !self.at(Punct::LBrace) {
            let Some(tag) = tag else {
                return err(kw_loc, format!("expected a tag or '{{' after '{kind}'"));
            };
            // `struct S;` declares S in the current scope even if an outer S exists.
            let existing = if self.at(Punct::Semi) {
                self.sema.lookup_tag_current_scope(&tag)
            } else {
                self.sema.lookup_tag(&tag)
            };
            return match existing {
                Some(Tag::Struct(id)) => {
                    if self.sema.tcx.struct_def(id).is_union != is_union {
                        return err(
                            kw_loc,
                            format!("'{tag}' was declared as a different kind of tag"),
                        );
                    }
                    Ok(Type::Struct(id))
                }
                Some(Tag::Enum(_)) => err(
                    kw_loc,
                    format!("'{tag}' was declared as a different kind of tag"),
                ),
                None => {
                    let id = self.sema.new_struct(Some(Rc::clone(&tag)), is_union);
                    self.sema.bind_tag(tag, Tag::Struct(id));
                    Ok(Type::Struct(id))
                }
            };
        }
        let id = match &tag {
            Some(tag) => match self.sema.lookup_tag_current_scope(tag) {
                Some(Tag::Struct(id)) => {
                    let def = self.sema.tcx.struct_def(id);
                    if def.is_union != is_union {
                        return err(
                            kw_loc,
                            format!("'{tag}' was declared as a different kind of tag"),
                        );
                    }
                    if def.is_complete() {
                        return err(kw_loc, format!("redefinition of '{kind} {tag}'"));
                    }
                    if self.open_structs.contains(&id) {
                        return err(kw_loc, format!("nested redefinition of '{kind} {tag}'"));
                    }
                    id
                }
                Some(Tag::Enum(_)) => {
                    return err(
                        kw_loc,
                        format!("'{tag}' was declared as a different kind of tag"),
                    );
                }
                None => {
                    let id = self.sema.new_struct(Some(Rc::clone(tag)), is_union);
                    self.sema.bind_tag(Rc::clone(tag), Tag::Struct(id));
                    id
                }
            },
            None => self.sema.new_struct(None, is_union),
        };
        self.expect(Punct::LBrace)?;
        self.open_structs.push(id);
        let pragma_pack = self.pack;
        let pragma_ms_struct = self.ms_struct;
        let mut fields: Vec<FieldDecl> = Vec::new();
        while !self.at(Punct::RBrace) {
            if self.cur.tok == Tok::Eof {
                return err(self.loc(), "expected '}' at the end of the member list");
            }
            if self.at_kw(Kw::StaticAssert) {
                self.parse_static_assert()?;
                continue;
            }
            if self.eat(Punct::Semi)? {
                continue;
            }
            let spec = self.parse_declspec()?;
            if spec.storage != Storage::None || spec.is_typedef {
                return err(spec.loc, "storage class specified for a struct member");
            }
            if self.at(Punct::Semi) {
                // An unnamed member of untagged struct/union type is an anonymous member.
                // (Microsoft lets the type be one that has a name, `POINT;`: its members are the
                // enclosing structure's all the same.)
                let is_anonymous = match &spec.ty {
                    Type::Struct(sid) => {
                        let def = self.sema.tcx.struct_def(*sid);
                        def.tag.is_none() || (self.dialect.microsoft && def.is_complete())
                    }
                    _ => false,
                };
                if is_anonymous {
                    fields.push(FieldDecl {
                        name: None,
                        ty: spec.ty,
                        loc: spec.loc,
                        bit_width: None,
                        align: spec.attrs.aligned,
                        packed: spec.attrs.packed,
                    });
                }
                self.bump()?;
                continue;
            }
            loop {
                // `int : 3;` is an unnamed bit-field.
                let decl = if self.at(Punct::Colon) {
                    Declarator {
                        ty: spec.ty.clone(),
                        name: None,
                        loc: self.loc(),
                        params: None,
                        attrs: Attrs::default(),
                    }
                } else {
                    self.parse_declarator(spec.ty.clone())?
                };
                let mut bit_width = None;
                if self.eat(Punct::Colon)? {
                    let e = self.parse_conditional()?;
                    let width = self.sema.const_int(&e)?;
                    let field_ty = decl.ty.unatomic();
                    if !field_ty.is_integer() || field_ty.is_int128() {
                        return err(decl.loc, "bit-field has a non-integer type");
                    }
                    if !(0..=64).contains(&width) {
                        return err(e.loc, "invalid bit-field width");
                    }
                    if matches!(field_ty.unqualified(), Type::Bool) && width > 1 {
                        return err(e.loc, "width of bit-field exceeds its type");
                    }
                    if decl.ty.is_atomic() {
                        return err(decl.loc, "a bit-field cannot have an atomic type");
                    }
                    if let Some((_, at)) = spec.attrs.alignas {
                        return err(at, "'_Alignas' cannot be applied to a bit-field");
                    }
                    if width == 0 && decl.name.is_some() {
                        return err(e.loc, "a named bit-field cannot have zero width");
                    }
                    bit_width = Some(width as u32);
                } else if decl.name.is_none() {
                    return err(decl.loc, "expected a member name");
                }
                let mut attrs = decl.attrs.clone();
                self.parse_attributes(&mut attrs)?;
                if decl.ty.is_func() {
                    return err(decl.loc, "member declared as a function");
                }
                self.check_alignas(&spec, &decl.ty)?;
                fields.push(FieldDecl {
                    name: decl.name,
                    ty: decl.ty,
                    loc: decl.loc,
                    bit_width,
                    align: match (attrs.aligned, spec.attrs.aligned) {
                        (Some(a), Some(b)) => Some(a.max(b)),
                        (a, b) => a.or(b),
                    },
                    packed: attrs.packed || spec.attrs.packed,
                });
                if !self.eat(Punct::Comma)? {
                    break;
                }
            }
            self.expect(Punct::Semi)?;
        }
        self.bump()?;
        self.open_structs.pop();
        self.parse_attributes(&mut struct_attrs)?;
        if let Some(ahead) = self.declspec_struct_align.take() {
            struct_attrs.aligned = Some(struct_attrs.aligned.unwrap_or(1).max(ahead));
        }
        // Microsoft's bit-field layout is what Windows targets have; the attributes and the
        // pragma choose it, or the other one, anywhere.
        let ms_bitfields = struct_attrs
            .ms_struct
            .unwrap_or(pragma_ms_struct || self.sema.tcx.target.os == crate::types::Os::Windows);
        self.sema.complete_struct(
            id,
            fields,
            crate::sema::LayoutRules {
                packed: struct_attrs.packed,
                min_align: struct_attrs.aligned,
                pragma_pack,
                bit_fields: if ms_bitfields {
                    crate::sema::BitFieldRules::Microsoft
                } else {
                    crate::sema::BitFieldRules::SystemV
                },
            },
            kw_loc,
        )?;
        if struct_attrs.transparent_union {
            self.sema.tcx.structs[id as usize].transparent = true;
        }
        if self
            .sema
            .tcx
            .size_of(&Type::Struct(id))
            .is_some_and(|s| s > MAX_OBJECT_SIZE)
        {
            return err(kw_loc, "struct is too large");
        }
        Ok(Type::Struct(id))
    }

    fn parse_enum_specifier(&mut self) -> Res<Type> {
        let kw_loc = self.bump()?.loc;
        let mut enum_attrs = Attrs::default();
        let mut ignored = Attrs::default();
        self.parse_attributes(&mut enum_attrs)?;
        let tag = match &self.cur.tok {
            Tok::Ident(name) => {
                let name = Rc::clone(name);
                self.bump()?;
                Some(name)
            }
            _ => None,
        };
        // `enum E : type` (C23, and clang before it): the enumeration's type is written out.
        // (In a structure `enum E : 3` is a bit-field; a type never starts with a number.)
        let mut fixed_type = None;
        if self.at(Punct::Colon) && self.next_is_type_start()? {
            self.bump()?;
            let ty = self.parse_type_name()?;
            if !ty.is_integer() {
                return err(
                    kw_loc,
                    "the underlying type of an enumeration must be an integer type",
                );
            }
            fixed_type = Some(ty.unqualified().clone());
        }
        if !self.at(Punct::LBrace) {
            let Some(tag) = tag else {
                return err(kw_loc, "expected a tag or '{' after 'enum'");
            };
            if let (Some(ty), None) = (&fixed_type, self.sema.lookup_tag(&tag)) {
                self.sema.bind_tag(tag, Tag::Enum(ty.clone()));
                return Ok(ty.clone());
            }
            if !self.sema.defined_enums.iter().any(|(_, name)| *name == tag) {
                self.incomplete_enum = Some(Rc::clone(&tag));
            }
            return match self.sema.lookup_tag(&tag) {
                Some(Tag::Enum(ty)) => Ok(ty),
                Some(Tag::Struct(_)) => err(
                    kw_loc,
                    format!("'{tag}' was declared as a different kind of tag"),
                ),
                None => {
                    self.sema.bind_tag(tag, Tag::Enum(Type::Int));
                    Ok(Type::Int)
                }
            };
        }
        if let Some(tag) = &tag {
            if self
                .sema
                .defined_enums
                .iter()
                .any(|(scope, name)| *scope == self.sema.scope_depth() && name == tag)
            {
                return err(kw_loc, format!("redefinition of 'enum {tag}'"));
            }
            self.sema
                .defined_enums
                .push((self.sema.scope_depth(), Rc::clone(tag)));
        }
        // `enum e;` before the definition (GNU C): what already uses it took it for an int.
        let forward_declared = tag.as_ref().is_some_and(|tag| {
            matches!(self.sema.lookup_tag_current_scope(tag), Some(Tag::Enum(_)))
        });
        if let Some(tag) = &tag {
            if matches!(
                self.sema.lookup_tag_current_scope(tag),
                Some(Tag::Struct(_))
            ) {
                return err(
                    kw_loc,
                    format!("'{tag}' was declared as a different kind of tag"),
                );
            }
            self.sema.bind_tag(Rc::clone(tag), Tag::Enum(Type::Int));
        }
        self.bump()?;
        let mut next_value: i64 = 0;
        let mut unsigned = false;
        // The range of the enumerators decides the type, the way GCC and clang choose it.
        let (mut any_negative, mut fits_int, mut fits_uint) = (false, true, true);
        let (mut lowest, mut highest) = (0i128, 0i128);
        let microsoft = self.sema.tcx.target.os == crate::types::Os::Windows;
        let mut consts = Vec::new();
        while !self.at(Punct::RBrace) {
            let (name, loc) = self.expect_ident()?;
            self.parse_attributes(&mut ignored)?;
            if self.eat(Punct::Assign)? {
                let e = self.parse_conditional()?;
                next_value = self.sema.const_int(&e)?;
                unsigned = !self.sema.tcx.is_signed(&e.ty);
            }
            if let Some(ty) = &fixed_type {
                let negative = next_value < 0 && !unsigned;
                let huge = next_value < 0 && unsigned;
                let signed = self.sema.tcx.is_signed(ty);
                if self.sema.wrap_int(next_value, ty) != next_value
                    || (negative && !signed)
                    || (huge && signed)
                {
                    return err(
                        loc,
                        format!(
                            "the value of '{name}' is outside the range of '{}'",
                            self.sema.tcx.display(ty)
                        ),
                    );
                }
            }
            // Microsoft's enumerations are all `int`, and so are their enumerators.
            let fixed = fixed_type
                .as_ref()
                .or_else(|| microsoft.then_some(&Type::Int));
            self.sema
                .declare_enum_const(Rc::clone(&name), next_value, unsigned, fixed, loc)?;
            consts.push((name, next_value));
            let huge = unsigned && next_value < 0;
            let exact = if huge {
                i128::from(next_value as u64)
            } else {
                i128::from(next_value)
            };
            (lowest, highest) = (lowest.min(exact), highest.max(exact));
            any_negative |= next_value < 0 && !huge;
            fits_int &= !huge && i32::try_from(next_value).is_ok();
            fits_uint &= !huge && u32::try_from(next_value).is_ok();
            next_value = next_value.wrapping_add(1);
            if !self.eat(Punct::Comma)? {
                break;
            }
        }
        self.expect(Punct::RBrace)?;
        self.parse_attributes(&mut enum_attrs)?;
        let fixed_type_absent = fixed_type.is_none();
        let ty = if let Some(fixed) = fixed_type {
            fixed
        } else if enum_attrs.packed && !microsoft {
            // The narrowest type that holds every enumerator.
            let holds = |bits: u32| {
                if any_negative {
                    lowest >= -(1i128 << (bits - 1)) && highest < 1i128 << (bits - 1)
                } else {
                    highest < 1i128 << bits
                }
            };
            match (
                any_negative,
                [8, 16, 32].into_iter().find(|bits| holds(*bits)),
            ) {
                (true, Some(8)) => Type::SChar,
                (false, Some(8)) => Type::UChar,
                (true, Some(16)) => Type::Short,
                (false, Some(16)) => Type::UShort,
                (true, Some(_)) => Type::Int,
                (false, Some(_)) => Type::UInt,
                (true, None) => Type::Long,
                (false, None) => Type::ULong,
            }
        } else if microsoft || (forward_declared && fits_int) {
            // Microsoft's enumerations are all `int`; so is one that was used before it was
            // defined, which whatever used it took it for.
            Type::Int
        } else if !any_negative && fits_uint {
            Type::UInt
        } else if fits_int {
            Type::Int
        } else if any_negative {
            Type::Long
        } else {
            Type::ULong
        };
        if !fits_int && fixed_type_absent && !microsoft {
            self.sema.retype_enum_consts(&consts, &ty);
        }
        if let Some(tag) = tag {
            self.sema.bind_tag(tag, Tag::Enum(ty.clone()));
        }
        Ok(ty)
    }

    // ───────────────────────────── declarators ─────────────────────────────

    /// Skips type qualifiers; returns whether `_Atomic` and `volatile` were among them.
    fn skip_qualifiers(&mut self) -> Res<(bool, Quals)> {
        let (mut atomic, mut quals) = (false, Quals::NONE);
        loop {
            match &self.cur.tok {
                Tok::Kw(Kw::Volatile) => {
                    quals = quals.with(Quals::VOLATILE);
                    self.bump()?;
                }
                Tok::Kw(Kw::Const) => {
                    quals = quals.with(Quals::CONST);
                    self.bump()?;
                }
                Tok::Kw(Kw::Restrict) => {
                    quals = quals.with(Quals::RESTRICT);
                    self.bump()?;
                }
                Tok::Kw(Kw::Atomic) => {
                    atomic = true;
                    self.bump()?;
                }
                Tok::Kw(Kw::Attribute) => {
                    let mut attrs = Attrs::default();
                    self.parse_attributes(&mut attrs)?;
                    if attrs.cleanup.is_some() {
                        self.declarator_cleanup = attrs.cleanup;
                    }
                }
                _ => return Ok((atomic, quals)),
            }
        }
    }

    /// Applies `vector_size` / `ext_vector_type` to the type they were written on.
    fn apply_vector_attrs(&mut self, ty: Type, attrs: &mut Attrs) -> Res<Type> {
        let ty = match attrs.mode.take() {
            Some((mode, loc)) => self.apply_mode(&ty, &mode, loc)?,
            None => ty,
        };
        if let Some((bytes, loc)) = attrs.vector_bytes.take() {
            return self.sema.vector_of_bytes(&ty, bytes, loc);
        }
        if let Some((count, loc)) = attrs.vector_count.take() {
            return self.sema.vector_of_count(&ty, count, loc);
        }
        Ok(ty)
    }

    /// `__attribute__((mode(M)))`: the type of `ty`'s kind (integer, keeping its signedness,
    /// or floating) that is as wide as machine mode `M`.
    fn apply_mode(&mut self, ty: &Type, mode: &str, loc: Loc) -> Res<Type> {
        let quals = ty.quals();
        let base = ty.unqualified();
        let mode = mode
            .strip_prefix("__")
            .and_then(|m| m.strip_suffix("__"))
            .unwrap_or(mode);
        // Vector modes: `V4SF` is four floats.
        let vector = match mode {
            "V16QI" => Some((Type::Char, 16)),
            "V8HI" => Some((Type::Short, 8)),
            "V4SI" => Some((Type::Int, 4)),
            "V2DI" => Some((Type::LLong, 2)),
            "V4SF" => Some((Type::Float, 4)),
            "V2DF" => Some((Type::Double, 2)),
            _ => None,
        };
        if let Some((element, count)) = vector {
            let element =
                if element.is_integer() && base.is_integer() && !self.sema.tcx.is_signed(base) {
                    element.to_unsigned()
                } else {
                    element
                };
            let ty = self.sema.vector_of_count(&element, count, loc)?;
            return Ok(ty.qualified(quals));
        }
        let pointer_bits = 64;
        // (is a floating mode, bits)
        let (floating, bits) = match mode {
            "QI" | "byte" => (false, 8),
            "HI" => (false, 16),
            "SI" => (false, 32),
            "DI" => (false, 64),
            "TI" => (false, 128),
            "word" | "pointer" | "unwind_word" | "libgcc_cmp_return" | "libgcc_shift_count" => {
                (false, pointer_bits)
            }
            "SF" => (true, 32),
            "DF" => (true, 64),
            "XF" => (true, 80),
            "TF" => (true, 128),
            "SC" | "DC" | "XC" | "TC" => {
                if !base.is_complex() && !matches!(base, Type::Wide(_)) {
                    return err(
                        loc,
                        format!(
                            "mode '{mode}' needs a complex type, not '{}'",
                            self.sema.tcx.display(base)
                        ),
                    );
                }
                let ty = match mode {
                    "SC" => Type::ComplexFloat,
                    "DC" => Type::ComplexDouble,
                    "XC" => Type::Wide(WideKind::ComplexLongDouble),
                    _ => Type::Wide(WideKind::ComplexFloat128),
                };
                return Ok(ty.qualified(quals));
            }
            _ => return err(loc, format!("unknown machine mode '{mode}'")),
        };
        let long_is_64 = self.sema.tcx.target.long_size() == 8;
        let result = if floating {
            if !base.is_float() && !matches!(base, Type::Wide(_)) {
                return err(
                    loc,
                    format!(
                        "mode '{mode}' needs a floating type, not '{}'",
                        self.sema.tcx.display(base)
                    ),
                );
            }
            match bits {
                32 => Type::Float,
                64 => Type::Double,
                80 if self.sema.tcx.target.long_double_is_x87() => Type::Wide(WideKind::LongDouble),
                80 => return err(loc, "mode 'XF' is not supported on this target"),
                _ => Type::Wide(WideKind::Float128),
            }
        } else {
            if !base.is_integer() {
                return err(
                    loc,
                    format!(
                        "mode '{mode}' needs an integer type, not '{}'",
                        self.sema.tcx.display(base)
                    ),
                );
            }
            let signed = self.sema.tcx.is_signed(base);
            match (bits, signed) {
                (8, true) => Type::SChar,
                (8, false) => Type::UChar,
                (16, true) => Type::Short,
                (16, false) => Type::UShort,
                (32, true) => Type::Int,
                (32, false) => Type::UInt,
                (64, true) if long_is_64 => Type::Long,
                (64, false) if long_is_64 => Type::ULong,
                (64, true) => Type::LLong,
                (64, false) => Type::ULLong,
                (_, true) => Type::Int128,
                (_, false) => Type::UInt128,
            }
        };
        Ok(result.qualified(quals))
    }

    /// Parses a (possibly abstract) declarator and applies it to `base`.
    fn parse_declarator(&mut self, base: Type) -> Res<Declarator> {
        let mut ops = Vec::new();
        let mut name = None;
        let loc = self.loc();
        let outer_cleanup = self.declarator_cleanup.take();
        self.parse_declarator_ops(&mut ops, &mut name)?;
        if !ops.is_empty() {
            self.check_derivations(base.derivations(MAX_DERIVATIONS) + ops.len())?;
        }
        let mut attrs = Attrs::default();
        self.parse_attributes(&mut attrs)?;
        let among_pointers = std::mem::replace(&mut self.declarator_cleanup, outer_cleanup);
        if attrs.cleanup.is_none() {
            attrs.cleanup = among_pointers;
        }
        // A vector attribute after the declarator applies to the innermost type.
        let mut ty = self.apply_vector_attrs(base, &mut attrs)?;
        let mut params = None;
        for op in ops {
            params = None;
            match op {
                DeclOp::Ptr { atomic, quals } => {
                    if quals.has(Quals::RESTRICT) && ty.is_func() {
                        return err(loc, "'restrict' qualifies only pointers to object types");
                    }
                    ty = ty.ptr_to();
                    if atomic {
                        ty = self.sema.atomic_of(ty, loc)?;
                    }
                    ty = ty.qualified(quals);
                }
                DeclOp::Array(len, aloc) => {
                    if ty.is_func() {
                        return err(aloc, "array of functions");
                    }
                    if ty.is_void() || !self.sema.tcx.is_complete(&ty) {
                        return err(
                            aloc,
                            format!(
                                "array has incomplete element type '{}'",
                                self.sema.tcx.display(&ty)
                            ),
                        );
                    }
                    let esize = self.sema.tcx.size_of(&ty).unwrap_or(0);
                    ty = match len {
                        ArrayLen::Unspecified => Type::Array(Rc::new(ty), None),
                        ArrayLen::Const(n) => {
                            if n.checked_mul(esize.max(1))
                                .is_none_or(|s| s > MAX_OBJECT_SIZE)
                            {
                                return err(aloc, "array is too large");
                            }
                            Type::Array(Rc::new(ty), Some(n))
                        }
                        // In a parameter list the bound is only evaluated if this turns
                        // out to be a function definition.
                        ArrayLen::Dynamic(len) if self.param_depth > 0 => {
                            self.sema.unbound_vla(ty, Some(len))
                        }
                        ArrayLen::Star if self.param_depth > 0 => {
                            if self.param_depth == 1 {
                                self.star_bound.get_or_insert(aloc);
                            }
                            self.sema.unbound_vla(ty, None)
                        }
                        ArrayLen::Star => {
                            return err(aloc, "'[*]' is only allowed in a parameter declaration");
                        }
                        ArrayLen::Dynamic(len) => {
                            if self.sema.func.is_none() {
                                return err(
                                    aloc,
                                    "a variable length array cannot be declared at file scope",
                                );
                            }
                            let (vla, evaluate) = self.sema.bound_vla(ty, len, aloc)?;
                            self.pending_vla.push(evaluate);
                            vla
                        }
                    };
                }
                DeclOp::Func {
                    params: ps,
                    variadic,
                    unprototyped,
                    loc: floc,
                } => {
                    if ty.is_func() {
                        return err(floc, "function cannot return a function");
                    }
                    if ty.is_array() {
                        return err(floc, "function cannot return an array");
                    }
                    // An identifier list says nothing about the types.
                    let fty = FuncType {
                        ret: ty.unatomic().clone(),
                        params: if unprototyped {
                            Vec::new()
                        } else {
                            ps.iter().map(|p| p.ty.clone()).collect()
                        },
                        variadic,
                        unprototyped,
                    };
                    ty = Type::Func(Rc::new(fty));
                    params = Some(ps);
                }
            }
        }
        let (name, loc) = match name {
            Some((n, l)) => (Some(n), l),
            None => (None, loc),
        };
        Ok(Declarator {
            ty,
            name,
            loc,
            attrs,
            params,
        })
    }

    /// A type is at most `MAX_DERIVATIONS` pointer, array and function types deep.
    fn check_derivations(&self, count: usize) -> Res<()> {
        if count > MAX_DERIVATIONS {
            return err(
                self.loc(),
                "a type is derived through too many pointers, arrays and functions",
            );
        }
        Ok(())
    }

    /// Collects the type derivations of a declarator in the order they apply to the base type.
    fn parse_declarator_ops(
        &mut self,
        ops: &mut Vec<DeclOp>,
        name: &mut Option<(Rc<str>, Loc)>,
    ) -> Res<()> {
        self.enter()?;
        if self.skip_qualifiers()?.0 {
            return self.unsupported("_Atomic in this position");
        }
        let mut pointers: Vec<(bool, Quals)> = Vec::new();
        while self.eat(Punct::Star)? {
            pointers.push(self.skip_qualifiers()?);
            self.check_derivations(pointers.len())?;
        }
        let mut inner = Vec::new();
        if self.at(Punct::LParen) && self.paren_starts_nested_declarator()? {
            self.bump()?;
            self.declarator_parens += 1;
            self.parse_declarator_ops(&mut inner, name)?;
            self.declarator_parens -= 1;
            self.expect(Punct::RParen)?;
        } else if let Tok::Ident(n) = &self.cur.tok {
            *name = Some((Rc::clone(n), self.loc()));
            self.bump()?;
            // `(*name __attribute__((unused)))(void)`: the outermost declarator's attributes
            // are read by the caller; nested ones only ever say how the name is used.
            if self.declarator_parens > 0 {
                let mut ignored = Attrs::default();
                self.parse_attributes(&mut ignored)?;
            }
        }
        let mut suffixes = Vec::new();
        loop {
            self.check_derivations(pointers.len() + suffixes.len())?;
            if self.at(Punct::LBracket) {
                if matches!(self.peek2()?, Tok::Punct(Punct::LBracket)) {
                    // `[[...]]` is an attribute, not an array declarator.
                    break;
                }
                let aloc = self.bump()?.loc;
                // `static` and qualifiers are allowed inside a parameter's array brackets, in the
                // outermost array derivation.
                let mut adorned = false;
                while self.eat_kw(Kw::Static)?
                    || self.eat_kw(Kw::Const)?
                    || self.eat_kw(Kw::Volatile)?
                    || self.eat_kw(Kw::Restrict)?
                {
                    adorned = true;
                }
                if adorned && (self.param_depth == 0 || !suffixes.is_empty()) {
                    return err(
                        aloc,
                        "'static' and type qualifiers in array brackets are only allowed in the outermost array type of a parameter",
                    );
                }
                let len = if self.at(Punct::RBracket) {
                    ArrayLen::Unspecified
                } else if self.at(Punct::Star)
                    && matches!(self.peek2()?, Tok::Punct(Punct::RBracket))
                {
                    self.bump()?;
                    ArrayLen::Star
                } else {
                    let e = self.parse_assign()?;
                    let e = self.sema.rvalue(e)?;
                    if !e.ty.is_integer() {
                        return err(e.loc, "size of array has non-integer type");
                    }
                    match self.sema.const_int(&e) {
                        Ok(n) if n < 0 && self.sema.tcx.is_signed(&e.ty) => {
                            return err(e.loc, "array size is negative");
                        }
                        Ok(n) => ArrayLen::Const(n as u64),
                        Err(error) if error.msg == crate::constexpr::NOT_CONSTANT => {
                            ArrayLen::Dynamic(e)
                        }
                        Err(error) => return Err(error),
                    }
                };
                self.expect(Punct::RBracket)?;
                suffixes.push(DeclOp::Array(len, aloc));
            } else if self.at(Punct::LParen) {
                let floc = self.bump()?.loc;
                suffixes.push(self.parse_parameter_list(floc)?);
            } else {
                break;
            }
        }
        ops.extend(
            pointers
                .into_iter()
                .map(|(atomic, quals)| DeclOp::Ptr { atomic, quals }),
        );
        ops.extend(suffixes.into_iter().rev());
        ops.append(&mut inner);
        self.leave();
        Ok(())
    }

    /// At `(` in declarator position: is this a parenthesised declarator (`(*fp)`) rather
    /// than a parameter list (`(int)`, `()`)?
    fn paren_starts_nested_declarator(&mut self) -> Res<bool> {
        let next = self.peek2()?.clone();
        Ok(match next {
            Tok::Punct(Punct::Star | Punct::LParen | Punct::LBracket) => true,
            Tok::Kw(Kw::Attribute) => true,
            Tok::Ident(name) => !self.sema.is_typedef_name(&name),
            _ => false,
        })
    }

    /// Parses a parameter list; the opening `(` has been consumed.
    fn parse_parameter_list(&mut self, loc: Loc) -> Res<DeclOp> {
        if self.eat(Punct::RParen)? {
            return Ok(DeclOp::Func {
                params: Vec::new(),
                variadic: false,
                unprototyped: true,
                loc,
            });
        }
        if self.at_kw(Kw::Void) && matches!(self.peek2()?, Tok::Punct(Punct::RParen)) {
            self.bump()?;
            self.bump()?;
            return Ok(DeclOp::Func {
                params: Vec::new(),
                variadic: false,
                unprototyped: false,
                loc,
            });
        }
        // `f(a, b)`: the identifier list of an old-style definition. Every parameter is an
        // `int` until the declarations that follow say otherwise.
        if !self.is_type_start()
            && matches!(self.cur.tok, Tok::Ident(_))
            && matches!(self.peek2()?, Tok::Punct(Punct::Comma | Punct::RParen))
        {
            let mut params: Vec<Param> = Vec::new();
            loop {
                let (name, nloc) = self.expect_ident()?;
                params.push(Param {
                    ty: Type::Int,
                    name: Some(name),
                    loc: nloc,
                    local_ty: Type::Int,
                    is_register: false,
                });
                if !self.eat(Punct::Comma)? {
                    break;
                }
            }
            self.expect(Punct::RParen)?;
            return Ok(DeclOp::Func {
                params,
                variadic: false,
                unprototyped: true,
                loc,
            });
        }
        // Tags declared inside a parameter list have prototype scope.
        self.sema.push_scope();
        self.param_depth += 1;
        let mut params: Vec<Param> = Vec::new();
        let mut variadic = false;
        loop {
            if self.eat(Punct::Ellipsis)? {
                variadic = true;
                break;
            }
            // `[[maybe_unused]] int n`: attributes of the parameter, ahead of its specifiers.
            if self.at(Punct::LBracket) && matches!(self.peek2()?, Tok::Punct(Punct::LBracket)) {
                let mut attrs = Attrs::default();
                self.parse_attributes(&mut attrs)?;
                self.leading_attrs = Some(attrs);
            }
            if !self.is_type_start() {
                if let Tok::Ident(name) = self.cur.tok.clone() {
                    return err(self.loc(), format!("unknown type name '{name}'"));
                }
                return err(
                    self.loc(),
                    format!(
                        "expected a parameter declaration before {}",
                        self.cur.tok.describe()
                    ),
                );
            }
            let spec = self.parse_declspec()?;
            if spec.is_typedef || matches!(spec.storage, Storage::Static | Storage::Extern) {
                return err(spec.loc, "invalid storage class for a parameter");
            }
            let is_register = spec.is_register;
            if let Some((_, at)) = spec.attrs.alignas {
                return err(at, "'_Alignas' cannot be applied to a parameter");
            }
            if spec.is_inline || spec.is_noreturn {
                return err(spec.loc, "a function specifier on a parameter");
            }
            let decl = self.parse_declarator(spec.ty)?;
            let quals = decl.ty.quals();
            // Parameters of array and function type are adjusted to pointers.
            let ty = match decl.ty {
                Type::Array(elem, _) | Type::Vla(elem, _) => Type::Ptr(elem),
                Type::Func(_) => decl.ty.ptr_to(),
                Type::Void => return err(decl.loc, "parameter has type void"),
                other => other.unatomic().clone(),
            };
            // Later parameters may use this one in an array bound: `int n, int a[n]`.
            if let Some(name) = &decl.name {
                if params.iter().any(|p: &Param| p.name.as_ref() == Some(name)) {
                    return err(decl.loc, format!("redefinition of '{name}'"));
                }
                self.sema
                    .bind_param(Rc::clone(name), params.len() as LocalId, ty.clone());
            }
            let local_ty = ty.clone().qualified(quals);
            params.push(Param {
                ty,
                name: decl.name,
                loc: decl.loc,
                local_ty,
                is_register,
            });
            if !self.eat(Punct::Comma)? {
                break;
            }
        }
        self.param_depth -= 1;
        self.sema.pop_scope();
        self.expect(Punct::RParen)?;
        Ok(DeclOp::Func {
            params,
            variadic,
            unprototyped: false,
            loc,
        })
    }

    /// `type-name` as used in casts, `sizeof` and `_Alignof`.
    fn parse_type_name(&mut self) -> Res<Type> {
        let spec = self.parse_declspec()?;
        if spec.is_typedef || spec.storage != Storage::None {
            return err(spec.loc, "storage class in a type name");
        }
        let decl = self.parse_declarator(spec.ty)?;
        if decl.name.is_some() {
            return err(decl.loc, "unexpected identifier in a type name");
        }
        Ok(decl.ty)
    }

    // ───────────────────────────── initializers ─────────────────────────────

    fn parse_initializer(&mut self) -> Res<Init> {
        if !self.at(Punct::LBrace) {
            return Ok(Init::Expr(self.parse_assign()?));
        }
        self.enter()?;
        let list_loc = self.bump()?.loc;
        let mut entries = Vec::new();
        while !self.at(Punct::RBrace) {
            let loc = self.loc();
            let mut designators = Vec::new();
            loop {
                if self.at(Punct::Dot) {
                    self.bump()?;
                    let (name, dloc) = self.expect_ident()?;
                    designators.push(Designator::Field(name, dloc));
                } else if self.at(Punct::LBracket) {
                    let dloc = self.bump()?.loc;
                    let e = self.parse_conditional()?;
                    let index = self.sema.const_int(&e)?;
                    if index < 0 {
                        return err(dloc, "array designator index is negative");
                    }
                    if self.eat(Punct::Ellipsis)? {
                        let e = self.parse_conditional()?;
                        let last = self.sema.const_int(&e)?;
                        if last < index {
                            return err(dloc, "array range designator is empty");
                        }
                        self.expect(Punct::RBracket)?;
                        designators.push(Designator::Range(index as u64, last as u64, dloc));
                    } else {
                        self.expect(Punct::RBracket)?;
                        designators.push(Designator::Index(index as u64, dloc));
                    }
                } else {
                    break;
                }
            }
            // The obsolete GNU spellings: `member: value` and `[index] value`.
            if designators.is_empty()
                && matches!(self.cur.tok, Tok::Ident(_))
                && matches!(self.peek2()?, Tok::Punct(Punct::Colon))
            {
                let (name, dloc) = self.expect_ident()?;
                self.bump()?;
                designators.push(Designator::Field(name, dloc));
            } else if !designators.is_empty() {
                let array_last = matches!(
                    designators.last(),
                    Some(Designator::Index(..) | Designator::Range(..))
                );
                if !self.eat(Punct::Assign)? && !array_last {
                    self.expect(Punct::Assign)?;
                }
            }
            let init = self.parse_initializer()?;
            // The initializer of a range is evaluated once: it goes through a temporary
            // unless it is a constant.
            let has_range = designators
                .iter()
                .any(|d| matches!(d, Designator::Range(..)));
            let once = match &init {
                Init::Expr(e)
                    if has_range
                        && self.sema.func.is_some()
                        && !self.sema.is_constant(e)
                        && (e.ty.is_scalar() || e.ty.is_ptr()) =>
                {
                    Some(self.sema.new_local(self.sema.rvalue_type(&e.ty)))
                }
                _ => None,
            };
            entries.push(InitEntry {
                designators,
                init,
                loc,
                once,
            });
            if !self.eat(Punct::Comma)? {
                break;
            }
        }
        self.expect(Punct::RBrace)?;
        self.leave();
        Ok(Init::List(entries, list_loc))
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// The items of a block up to and including its `}`. From the first declaration of a
    /// variable length array object on, the items form a `VlaScope`.
    fn parse_block_items(&mut self) -> Res<Vec<Stmt>> {
        let mut stmts = Vec::new();
        // The scopes this block opens: where in `stmts` each starts, its id and its cleanup.
        let mut scopes: Vec<(usize, u32, Option<Box<Expr>>)> = Vec::new();
        let mut has_vla_scope = false;
        let outer_declared = std::mem::replace(&mut self.vla_declared, false);
        let outer_cleanups = std::mem::take(&mut self.pending_cleanups);
        // `__label__ a, b;` first: labels that belong to this block alone.
        let mut label_scope: Option<usize> = None;
        while matches!(&self.cur.tok, Tok::Ident(name) if &**name == "__label__") {
            let loc = self.bump()?.loc;
            let depth = match (label_scope, &mut self.sema.func) {
                (Some(depth), _) => depth,
                (None, Some(f)) => {
                    f.local_labels.push(BTreeMap::new());
                    f.local_labels.len() - 1
                }
                (None, None) => return err(loc, "label outside of a function"),
            };
            label_scope = Some(depth);
            loop {
                let (name, nloc) = self.expect_ident()?;
                self.sema.declare_local_label(&name, depth, nloc)?;
                if !self.eat(Punct::Comma)? {
                    break;
                }
            }
            self.expect(Punct::Semi)?;
        }
        while !self.at(Punct::RBrace) {
            if self.cur.tok == Tok::Eof {
                return err(self.loc(), "expected '}' before end of file");
            }
            let before = stmts.len();
            self.parse_block_item(&mut stmts)?;
            if std::mem::replace(&mut self.vla_declared, false) && !has_vla_scope {
                let id = self.sema.new_vla_scope();
                self.vla_path.push(id);
                scopes.push((before, id, None));
                has_vla_scope = true;
            }
            // A variable with a cleanup: what follows its declaration is a scope of its own.
            for cleanup in std::mem::take(&mut self.pending_cleanups) {
                let id = self.sema.new_vla_scope();
                self.vla_path.push(id);
                scopes.push((stmts.len(), id, Some(Box::new(cleanup))));
            }
        }
        self.bump()?;
        self.vla_declared = outer_declared;
        self.pending_cleanups = outer_cleanups;
        if let (Some(depth), Some(f)) = (label_scope, &mut self.sema.func) {
            f.local_labels.truncate(depth);
        }
        while let Some((start, id, cleanup)) = scopes.pop() {
            self.vla_path.pop();
            let body = stmts.split_off(start.min(stmts.len()));
            stmts.push(Stmt::VlaScope { id, cleanup, body });
        }
        Ok(stmts)
    }

    /// Moves the pending variable length array bound evaluations into `out`.
    fn flush_pending_vla(&mut self, out: &mut Vec<Stmt>) {
        out.extend(self.pending_vla.drain(..).map(Stmt::Expr));
    }

    /// Makes `e` evaluate the pending variable length array bounds first.
    fn after_pending_vla(&mut self, e: Expr) -> Res<Expr> {
        let mut result = e;
        for evaluate in std::mem::take(&mut self.pending_vla).into_iter().rev() {
            let (ty, loc) = (result.ty.clone(), result.loc);
            result = self.sema.mk(
                ExprKind::Comma(Box::new(evaluate), Box::new(result)),
                ty,
                loc,
            )?;
        }
        Ok(result)
    }

    /// The attributes in front of a block item, kept for the declaration they may belong to.
    /// False if they were a statement by themselves (`[[fallthrough]];`).
    #[inline(never)]
    fn parse_leading_attributes(&mut self) -> Res<bool> {
        let mut attrs = Attrs::default();
        self.parse_attributes(&mut attrs)?;
        if self.eat(Punct::Semi)? {
            return Ok(false);
        }
        self.leading_attrs = Some(attrs);
        Ok(true)
    }

    fn parse_block_item(&mut self, out: &mut Vec<Stmt>) -> Res<()> {
        self.flush_pending_vla(out);
        if self.at_kw(Kw::StaticAssert) {
            return self.parse_static_assert();
        }
        while self.eat_kw(Kw::Extension)? {}
        // `__attribute__((fallthrough));` / `[[fallthrough]];`, or attributes that start a declaration.
        let bracket_attr =
            self.at(Punct::LBracket) && matches!(self.peek2()?, Tok::Punct(Punct::LBracket));
        if self.at_kw(Kw::Attribute) || bracket_attr {
            if !self.parse_leading_attributes()? {
                return Ok(());
            }
            // They belong to the declaration that follows; ahead of a label or a statement
            // (`[[likely]]`, `[[maybe_unused]] out:`) they say nothing that changes it.
            let labels = matches!(self.cur.tok, Tok::Ident(_))
                && matches!(self.peek2()?, Tok::Punct(Punct::Colon));
            if self.is_type_start() && !labels {
                return self.parse_local_declaration(out);
            }
            self.leading_attrs = None;
            out.push(self.parse_statement()?);
            return Ok(());
        }
        // `name:` is a label even when `name` is a typedef.
        let is_label = matches!(self.cur.tok, Tok::Ident(_))
            && matches!(self.peek2()?, Tok::Punct(Punct::Colon));
        if !is_label && self.is_type_start() {
            return self.parse_local_declaration(out);
        }
        if !is_label
            && matches!(&self.cur.tok, Tok::Ident(name) if &**name == "__auto_type")
            && self.sema.lookup("__auto_type").is_none()
        {
            return self.parse_auto_type_declaration(out);
        }
        out.push(self.parse_statement()?);
        Ok(())
    }

    /// GNU C `__auto_type name = value;`: the variable has the type of the value.
    fn parse_auto_type_declaration(&mut self, out: &mut Vec<Stmt>) -> Res<()> {
        self.bump()?;
        let (name, loc) = self.expect_ident()?;
        if !self.eat(Punct::Assign)? {
            return err(loc, "a declaration with '__auto_type' needs an initializer");
        }
        let value = self.parse_assign()?;
        let value = self.sema.rvalue(value)?;
        if value.ty.is_void() {
            return err(
                loc,
                "the initializer of an '__auto_type' variable has no value",
            );
        }
        self.expect(Punct::Semi)?;
        self.flush_pending_vla(out);
        let ty = value.ty.clone();
        let local = self.sema.declare_local(name, ty.clone(), loc)?;
        let target = self.sema.mk(ExprKind::Local(local), ty, loc)?;
        let store = self.sema.assign(target, value, loc)?;
        out.push(Stmt::Expr(store));
        Ok(())
    }

    fn parse_local_declaration(&mut self, out: &mut Vec<Stmt>) -> Res<()> {
        let spec = self.parse_declspec()?;
        if self.eat(Punct::Semi)? {
            return Ok(());
        }
        self.flush_pending_vla(out);
        loop {
            let decl = self.parse_declarator(spec.ty.clone())?;
            self.flush_pending_vla(out);
            let Some(name) = decl.name.clone() else {
                return err(decl.loc, "expected an identifier in the declaration");
            };
            let variably_sized = self.sema.tcx.is_variably_sized(&decl.ty);
            if variably_sized && !spec.is_typedef && spec.storage != Storage::None {
                return err(
                    decl.loc,
                    "a variable length array must have automatic storage duration",
                );
            }
            let align = match (decl.attrs.aligned, spec.attrs.aligned) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, b) => a.or(b),
            };
            if spec.is_typedef {
                self.check_typedef_specifiers(&spec)?;
                self.mark_transparent_union(&decl, &spec);
                // On a typedef `aligned` sets the alignment, up or down.
                let ty = match align {
                    Some(a) if !decl.ty.is_func() => decl.ty.clone().with_alignment(a),
                    _ => decl.ty.clone(),
                };
                self.sema.declare_typedef(name, ty, decl.loc)?;
            } else if let Type::Func(fty) = &decl.ty {
                if self.at(Punct::LBrace) {
                    return err(
                        decl.loc,
                        "nested functions (a GNU C extension) are not supported: calling one through a pointer needs code on an executable stack",
                    );
                }
                self.declare_function(name, Rc::clone(fty), &decl, &spec, false)?;
            } else if decl.ty.is_void() {
                return err(decl.loc, format!("variable '{name}' has type void"));
            } else if let Err(error) = self.check_object_specifiers(&spec, &decl) {
                return Err(error);
            } else if spec.storage == Storage::Extern {
                if self.at(Punct::Assign) {
                    return err(
                        decl.loc,
                        "a block-scope extern declaration cannot have an initializer",
                    );
                }
                let first = !self.sema.is_file_scope_object(&name);
                let id = self.sema.declare_global(name, decl.ty, false, decl.loc)?;
                self.sema
                    .set_global_attrs(id, align, decl.attrs.asm_label.clone());
                self.sema.set_thread_local(
                    id,
                    spec.thread_local,
                    crate::sema::Declared::first_time(first),
                    decl.loc,
                )?;
            } else if spec.storage == Storage::Static {
                let id = self.parse_static_local(name, &decl, spec.thread_local)?;
                self.sema.set_global_attrs(id, align, None);
            } else if spec.thread_local {
                return err(
                    decl.loc,
                    "a block-scope thread-local variable must be static or extern",
                );
            } else {
                let local = self.parse_auto_local(Rc::clone(&name), &decl, align, out)?;
                if spec.is_register {
                    self.sema.set_local_register(local);
                }
                if let Some(a) = align {
                    self.sema.set_local_align(local, a);
                }
                let cleanup = decl
                    .attrs
                    .cleanup
                    .clone()
                    .or_else(|| spec.attrs.cleanup.clone());
                if let Some((function, cloc)) = cleanup {
                    // `function(&variable)` when the variable's scope is left.
                    let callee = self.sema.ident(&function, cloc)?;
                    let variable = self.sema.ident(&name, cloc)?;
                    let address = self.sema.addr_of(variable, cloc)?;
                    let call = self.sema.call(callee, vec![address], cloc)?;
                    let call = self.sema.cast(call, &Type::Void, cloc)?;
                    self.pending_cleanups.push(call);
                }
            }
            if !self.eat(Punct::Comma)? {
                break;
            }
        }
        self.expect(Punct::Semi)?;
        Ok(())
    }

    fn parse_static_local(
        &mut self,
        name: Rc<str>,
        decl: &Declarator,
        thread_local: bool,
    ) -> Res<GlobalId> {
        let has_init = self.at(Punct::Assign);
        if !has_init && !self.sema.tcx.is_complete(&decl.ty) {
            return err(
                decl.loc,
                format!(
                    "variable '{name}' has incomplete type '{}'",
                    self.sema.tcx.display(&decl.ty)
                ),
            );
        }
        self.check_object_size(&decl.ty, decl.loc)?;
        let id = self
            .sema
            .declare_static_local(name, decl.ty.clone(), decl.loc)?;
        self.sema.globals[id as usize].thread_local = thread_local;
        if has_init {
            self.bump()?;
            let init = self.parse_initializer()?;
            let (ty, items) = self.sema.elaborate_init(&decl.ty, init, decl.loc)?;
            let (bytes, relocs) =
                self.sema
                    .static_init_data(&ty, &items, thread_local, decl.loc)?;
            let extra_size = self.sema.flexible_extra(&ty);
            let g = &mut self.sema.globals[id as usize];
            g.extra_size = extra_size;
            g.ty = ty;
            g.init = bytes;
            g.relocs = relocs;
            g.has_initializer = true;
        }
        Ok(id)
    }

    fn parse_auto_local(
        &mut self,
        name: Rc<str>,
        decl: &Declarator,
        declared_align: Option<u64>,
        out: &mut Vec<Stmt>,
    ) -> Res<LocalId> {
        let has_init = self.at(Punct::Assign);
        if self.sema.tcx.is_variably_sized(&decl.ty) {
            if has_init {
                return err(decl.loc, "a variable length array cannot be initialized");
            }
            let size = self.sema.size_of_expr(&decl.ty, decl.loc)?;
            let align = self
                .sema
                .tcx
                .align_of(&decl.ty)
                .unwrap_or(1)
                .max(declared_align.unwrap_or(1))
                .max(16);
            let local = self.sema.declare_local(name, decl.ty.clone(), decl.loc)?;
            out.push(Stmt::VlaAlloc { local, size, align });
            self.vla_declared = true;
            return Ok(local);
        }
        let is_unsized_array = matches!(decl.ty, Type::Array(_, None));
        if is_unsized_array && !has_init {
            return err(
                decl.loc,
                format!("array '{name}' needs an explicit size or an initializer"),
            );
        }
        self.check_object_size(&decl.ty, decl.loc)?;
        // The name is in scope inside its own initializer. An unsized array gets a
        // placeholder length until the initializer has been counted.
        let declared_ty = match &decl.ty {
            Type::Array(elem, None) => Type::Array(Rc::clone(elem), Some(0)),
            other => other.clone(),
        };
        let local = self.sema.declare_local(name, declared_ty, decl.loc)?;
        if !has_init {
            return Ok(local);
        }
        self.bump()?;
        let init = self.parse_initializer()?;
        let (ty, items) = self.sema.elaborate_init(&decl.ty, init, decl.loc)?;
        if self.sema.flexible_end.get() > 0 {
            return err(
                decl.loc,
                "a flexible array member can only be initialized in an object with static storage duration",
            );
        }
        if is_unsized_array {
            self.sema.set_local_type(local, ty.clone());
        }
        let zero_first = self.sema.clears_before(&ty, &items);
        out.push(Stmt::LocalInit {
            local,
            zero_first,
            items,
        });
        Ok(local)
    }

    fn parse_statement(&mut self) -> Res<Stmt> {
        self.enter()?;
        // A selection or iteration statement is a block of its own (C11 6.8.4p3, 6.8.5p5):
        // what its controlling expression declares ends with it.
        let is_block = matches!(
            self.cur.tok,
            Tok::Kw(Kw::If | Kw::Switch | Kw::While | Kw::Do | Kw::For)
        );
        if is_block {
            self.sema.push_scope();
        }
        let stmt = self.parse_statement_inner()?;
        if is_block {
            self.sema.pop_scope();
        }
        self.leave();
        Ok(stmt)
    }

    fn parse_loop_body(&mut self) -> Res<Stmt> {
        self.break_targets += 1;
        self.continue_targets += 1;
        let body = self.parse_statement()?;
        self.break_targets -= 1;
        self.continue_targets -= 1;
        Ok(body)
    }

    fn parse_paren_condition(&mut self) -> Res<Expr> {
        self.expect(Punct::LParen)?;
        let e = self.parse_expr()?;
        let cond = self.sema.condition(e)?;
        self.expect(Punct::RParen)?;
        Ok(cond)
    }

    // The statements with more to them than a dispatcher should carry: each is a function of
    // its own, so that the nesting of one statement in another costs the stack of the dispatcher
    // and of that one kind of statement only.
    #[inline(never)]
    fn parse_if_statement(&mut self) -> Res<Stmt> {
        // `if … else if … else if …` is a chain, which a loop follows: its length is not
        // nesting. Each `if` after an `else` is still a block of its own.
        let mut arms = Vec::new();
        let mut inner_scopes = 0;
        let otherwise = loop {
            self.bump()?;
            let cond = self.parse_paren_condition()?;
            let then = self.parse_statement()?;
            arms.push((cond, then));
            if !self.eat_kw(Kw::Else)? {
                break None;
            }
            if !self.at_kw(Kw::If) {
                break Some(self.parse_statement()?);
            }
            self.sema.push_scope();
            inner_scopes += 1;
        };
        for _ in 0..inner_scopes {
            self.sema.pop_scope();
        }
        if arms.len() == 1 {
            let (cond, then) = arms.swap_remove(0);
            return Ok(Stmt::If(cond, Box::new(then), otherwise.map(Box::new)));
        }
        // A chain is a sequence: every arm but the last ends by going past the others.
        let end = self.sema.new_label();
        self.sema.set_label_vla_path(end, &self.vla_path);
        let last = arms.len() - 1;
        let mut chain = Vec::with_capacity(arms.len() + 2);
        for (i, (cond, then)) in arms.into_iter().enumerate() {
            let then = if i == last && otherwise.is_none() {
                then
            } else {
                Stmt::Block(vec![then, Stmt::Goto(end)])
            };
            chain.push(Stmt::If(cond, Box::new(then), None));
        }
        chain.extend(otherwise);
        chain.push(Stmt::Label(vec![end], Box::new(Stmt::Empty)));
        Ok(Stmt::Block(chain))
    }

    #[inline(never)]
    fn parse_for_statement(&mut self) -> Res<Stmt> {
        self.bump()?;
        self.expect(Punct::LParen)?;
        self.sema.push_scope();
        // The variables the first clause declares with a cleanup: the whole loop is
        // their scope.
        let mut cleanups: Vec<(u32, Expr)> = Vec::new();
        let init = if self.eat(Punct::Semi)? {
            None
        } else if self.is_type_start() {
            let mut stmts = Vec::new();
            self.parse_local_declaration(&mut stmts)?;
            for cleanup in std::mem::take(&mut self.pending_cleanups) {
                let id = self.sema.new_vla_scope();
                self.vla_path.push(id);
                cleanups.push((id, cleanup));
            }
            Some(Box::new(Stmt::Block(stmts)))
        } else {
            let e = self.parse_expr()?;
            self.expect(Punct::Semi)?;
            Some(Box::new(Stmt::Expr(e)))
        };
        let cond = if self.at(Punct::Semi) {
            None
        } else {
            let e = self.parse_expr()?;
            Some(Box::new(self.sema.condition(e)?))
        };
        self.expect(Punct::Semi)?;
        let step = if self.at(Punct::RParen) {
            None
        } else {
            Some(Box::new(self.parse_expr()?))
        };
        self.expect(Punct::RParen)?;
        let body = self.parse_loop_body()?;
        self.sema.pop_scope();
        if cleanups.is_empty() {
            return Ok(Stmt::For {
                init,
                cond,
                step,
                body: Box::new(body),
            });
        }
        let mut scoped = vec![Stmt::For {
            init: None,
            cond,
            step,
            body: Box::new(body),
        }];
        while let Some((id, cleanup)) = cleanups.pop() {
            self.vla_path.pop();
            scoped = vec![Stmt::VlaScope {
                id,
                cleanup: Some(Box::new(cleanup)),
                body: scoped,
            }];
        }
        let mut stmts: Vec<Stmt> = init.map(|init| *init).into_iter().collect();
        stmts.append(&mut scoped);
        Ok(Stmt::Block(stmts))
    }

    #[inline(never)]
    fn parse_switch_statement(&mut self, loc: Loc) -> Res<Stmt> {
        self.bump()?;
        self.expect(Punct::LParen)?;
        let e = self.parse_expr()?;
        let e = self.sema.rvalue(e)?;
        if !e.ty.is_integer() {
            return err(e.loc, "switch quantity is not an integer");
        }
        if e.ty.is_int128() {
            return err(e.loc, "a switch on a 128-bit integer is not supported yet");
        }
        let cond = self.sema.promote(e)?;
        self.expect(Punct::RParen)?;
        self.switches.push(SwitchCtx {
            vla_path: self.vla_path.clone(),
            cond_ty: cond.ty.clone(),
            cases: Vec::new(),
            ranges: std::collections::BTreeMap::new(),
            default: None,
        });
        self.break_targets += 1;
        let body = self.parse_statement()?;
        self.break_targets -= 1;
        let Some(ctx) = self.switches.pop() else {
            return err(loc, "internal error: switch context lost");
        };
        Ok(Stmt::Switch {
            cond: Box::new(cond),
            body: Box::new(body),
            cases: ctx.cases,
            default: ctx.default,
        })
    }

    #[inline(never)]
    fn parse_goto_statement(&mut self, loc: Loc) -> Res<Stmt> {
        self.bump()?;
        if self.eat(Punct::Star)? {
            let target = self.parse_expr()?;
            let target = self.sema.rvalue(target)?;
            if !target.ty.is_ptr() {
                return err(loc, "the operand of 'goto *' must be a pointer");
            }
            self.expect(Punct::Semi)?;
            if !self.vla_path.is_empty() {
                return err(
                    loc,
                    "a computed goto in the scope of a variable length array is not supported",
                );
            }
            self.computed_goto = Some(loc);
            return Ok(Stmt::GotoComputed(target));
        }
        let (name, nloc) = self.expect_ident()?;
        self.expect(Punct::Semi)?;
        let label = self.sema.named_label(&name, false, nloc)?;
        self.gotos.push((label, self.vla_path.clone(), nloc));
        Ok(Stmt::Goto(label))
    }

    #[inline(never)]
    fn parse_return_statement(&mut self, loc: Loc) -> Res<Stmt> {
        self.bump()?;
        if self.eat(Punct::Semi)? {
            if self.sema.func.as_ref().is_some_and(|f| !f.ret.is_void()) {
                return err(loc, "a function that returns a value needs one in 'return'");
            }
            return Ok(Stmt::Return(None));
        }
        let e = self.parse_expr()?;
        self.expect(Punct::Semi)?;
        // `return f();` in a void function is accepted when f() is void too.
        let returns_void = self.sema.func.as_ref().is_some_and(|f| f.ret.is_void());
        if returns_void && e.ty.is_void() {
            return Ok(Stmt::Block(vec![Stmt::Expr(e), Stmt::Return(None)]));
        }
        Ok(Stmt::Return(Some(self.sema.return_value(e, loc)?)))
    }

    fn parse_statement_inner(&mut self) -> Res<Stmt> {
        let loc = self.loc();
        // A run of labels belongs to one statement, however long it is.
        let mut labels = Vec::new();
        // The `case` and `default` labels of one run are one place to jump to: one label.
        let mut of_the_switch = None;
        while let Some(label) = self.parse_label(&mut of_the_switch)? {
            if labels.last() != Some(&label) {
                labels.push(label);
            }
        }
        if !labels.is_empty() {
            let stmt = self.parse_labeled_body()?;
            return Ok(Stmt::Label(labels, Box::new(stmt)));
        }
        match &self.cur.tok {
            Tok::Punct(Punct::Semi) => {
                self.bump()?;
                Ok(Stmt::Empty)
            }
            Tok::Punct(Punct::LBrace) => {
                self.bump()?;
                self.sema.push_scope();
                let stmts = self.parse_block_items()?;
                self.sema.pop_scope();
                Ok(Stmt::Block(stmts))
            }
            Tok::Kw(Kw::Try | Kw::Leave) => self.parse_structured_exception_handling(),
            Tok::Kw(Kw::If) => self.parse_if_statement(),
            Tok::Kw(Kw::While) => {
                self.bump()?;
                let cond = self.parse_paren_condition()?;
                let body = self.parse_loop_body()?;
                Ok(Stmt::While(cond, Box::new(body)))
            }
            Tok::Kw(Kw::Do) => {
                self.bump()?;
                let body = self.parse_loop_body()?;
                if !self.eat_kw(Kw::While)? {
                    return err(
                        self.loc(),
                        "expected 'while' after the body of a do statement",
                    );
                }
                let cond = self.parse_paren_condition()?;
                self.expect(Punct::Semi)?;
                Ok(Stmt::DoWhile(Box::new(body), cond))
            }
            Tok::Kw(Kw::For) => self.parse_for_statement(),
            Tok::Kw(Kw::Switch) => self.parse_switch_statement(loc),
            Tok::Kw(Kw::Break) => {
                self.bump()?;
                self.expect(Punct::Semi)?;
                if self.break_targets == 0 {
                    return err(loc, "'break' statement not in a loop or switch");
                }
                Ok(Stmt::Break)
            }
            Tok::Kw(Kw::Continue) => {
                self.bump()?;
                self.expect(Punct::Semi)?;
                if self.continue_targets == 0 {
                    return err(loc, "'continue' statement not in a loop");
                }
                Ok(Stmt::Continue)
            }
            Tok::Kw(Kw::Goto) => self.parse_goto_statement(loc),
            Tok::Kw(Kw::Return) => self.parse_return_statement(loc),
            Tok::Kw(Kw::Asm) => self.parse_asm_statement(),
            _ => {
                let e = self.parse_expr()?;
                self.expect(Punct::Semi)?;
                Ok(Stmt::Expr(self.sema.expression_statement(e)))
            }
        }
    }

    /// `asm [volatile] ( "template" : outputs : inputs : clobbers );`
    ///
    /// There is no assembler. The statements that mean the same on every processor are
    /// accepted: an empty template or one made of spin-loop hints (a compiler barrier, and
    /// a memory barrier when it clobbers memory); and on x86-64 the `cpuid` idiom in all its
    /// save-rbx spellings, which becomes the `CpuId` instruction, and `xgetbv`, which reads
    /// zero: no extended state is enabled, so nobody takes a path that needs wider vectors.
    fn parse_asm_statement(&mut self) -> Res<Stmt> {
        let loc = self.bump()?.loc;
        let mut is_volatile = false;
        loop {
            match &self.cur.tok {
                Tok::Kw(Kw::Volatile) => {
                    is_volatile = true;
                    self.bump()?;
                }
                Tok::Kw(Kw::Inline) => {
                    self.bump()?;
                }
                Tok::Kw(Kw::Goto) => return err(loc, "asm goto is not supported"),
                _ => break,
            }
        }
        self.expect(Punct::LParen)?;
        let mut template = Vec::new();
        while let Tok::Str(part, ..) = &self.cur.tok {
            template.extend_from_slice(part);
            self.bump()?;
        }
        // outputs, inputs: [name] "constraint" (expression)
        let mut operands: [Vec<(Vec<u8>, Expr)>; 2] = [Vec::new(), Vec::new()];
        let mut operand_names: [Vec<Option<Vec<u8>>>; 2] = [Vec::new(), Vec::new()];
        let mut clobber_list: Vec<Vec<u8>> = Vec::new();
        let mut clobbers_memory = false;
        // Without a colon the statement is "basic asm": its text is the instructions as they
        // are, and a `%` in it is a percent sign rather than the start of an operand.
        if !self.at(Punct::Colon) {
            let mut literal = Vec::with_capacity(template.len());
            for &byte in &template {
                literal.push(byte);
                if byte == b'%' {
                    literal.push(b'%');
                }
            }
            template = literal;
        }
        for section in 0..3 {
            if !(self.eat(Punct::Colon)?) {
                break;
            }
            if self.at(Punct::Colon) || self.at(Punct::RParen) {
                continue;
            }
            loop {
                if section == 2 {
                    let Tok::Str(name, ..) = &self.cur.tok else {
                        return err(self.loc(), "expected a clobber string");
                    };
                    clobbers_memory |= &name[..] == b"memory";
                    clobber_list.push(name.clone());
                    self.bump()?;
                } else {
                    let mut operand_name = None;
                    if self.eat(Punct::LBracket)? {
                        operand_name = Some(self.expect_ident()?.0.as_bytes().to_vec());
                        self.expect(Punct::RBracket)?;
                    }
                    operand_names[section].push(operand_name);
                    let mut constraint = Vec::new();
                    while let Tok::Str(part, ..) = &self.cur.tok {
                        constraint.extend_from_slice(part);
                        self.bump()?;
                    }
                    if constraint.is_empty() {
                        return err(self.loc(), "expected an operand constraint string");
                    }
                    self.expect(Punct::LParen)?;
                    let operand = self.parse_expr()?;
                    self.expect(Punct::RParen)?;
                    operands[section].push((constraint, operand));
                }
                if !self.eat(Punct::Comma)? {
                    break;
                }
            }
        }
        self.expect(Punct::RParen)?;
        self.expect(Punct::Semi)?;
        let [mut outputs, mut inputs] = operands;

        // The instructions: a mnemonic and its operands, lower case, without `%` and blanks.
        let mut instructions: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        let (mut mnemonic, mut arguments, mut in_arguments) = (Vec::new(), Vec::new(), false);
        for &byte in template.iter().chain(std::iter::once(&b'\n')) {
            match byte {
                b'\n' | b';' => {
                    if !mnemonic.is_empty() {
                        instructions.push((
                            std::mem::take(&mut mnemonic),
                            std::mem::take(&mut arguments),
                        ));
                    }
                    arguments.clear();
                    in_arguments = false;
                }
                b' ' | b'\t' | b'\r' => in_arguments |= !mnemonic.is_empty(),
                b'%' => {}
                _ if in_arguments => arguments.push(byte.to_ascii_lowercase()),
                _ => mnemonic.push(byte.to_ascii_lowercase()),
            }
        }
        let is = |m: &[u8], names: &[&[u8]]| names.contains(&m);
        let x86 = self.sema.tcx.target.arch == crate::types::Arch::X86_64;
        let hints: &[&[u8]] = if x86 {
            &[b"pause", b"rep", b"nop", b"lfence", b"sfence"]
        } else {
            &[b"yield", b"nop", b"isb"]
        };
        // The ways of spelling a full memory fence.
        let locked_no_op = |text: &[u8]| {
            [
                &b"orl$0,(rsp)"[..],
                b"addl$0,(rsp)",
                b"orq$0,(rsp)",
                b"addq$0,(rsp)",
                b"orl$0,(esp)",
                b"addl$0,(esp)",
            ]
            .contains(&text)
        };
        let full_fence = outputs.is_empty()
            && inputs.is_empty()
            && match instructions.as_slice() {
                [(m, a)] if x86 && &m[..] == b"mfence" => a.is_empty(),
                [(m, a)] if x86 && &m[..] == b"lock" => locked_no_op(a),
                [(lock, none), (m, a)] if x86 && &lock[..] == b"lock" && none.is_empty() => {
                    let mut joined = m.clone();
                    joined.extend_from_slice(a);
                    locked_no_op(&joined)
                }
                // Any `dmb` is at most this strong. (Accepted for every target: code that
                // asks `if (ARM)` at run time has it in its x86 build too.)
                [(m, a)] if &m[..] == b"dmb" => [
                    &b"ish"[..],
                    b"sy",
                    b"ishst",
                    b"ishld",
                    b"st",
                    b"ld",
                    b"osh",
                    b"oshst",
                    b"oshld",
                    b"nsh",
                ]
                .contains(&&a[..]),
                _ => false,
            };
        // The ways of stopping the program on purpose.
        let traps = outputs.is_empty()
            && matches!(instructions.as_slice(), [(m, _)] if [&b"int3"[..], b"ud2", b"brk", b"udf"].contains(&&m[..]));
        if traps {
            // (Operands only put values where a debugger would look for them.)
            let mut stmts = Vec::new();
            if !inputs.is_empty() {
                let inputs = inputs.into_iter().map(|(_, e)| e).collect();
                stmts.push(Stmt::Expr(self.sema.discard_all(inputs, loc)?));
            }
            let mut trap = self.sema.mk(
                ExprKind::Intrinsic(Intrinsic::Trap, Vec::new()),
                Type::Void,
                loc,
            )?;
            trap.has_control_flow = true;
            stmts.push(Stmt::Expr(trap));
            return Ok(Stmt::Block(stmts));
        }
        if full_fence {
            return Ok(Stmt::Expr(self.sema.mk(
                ExprKind::Intrinsic(Intrinsic::FullBarrier, Vec::new()),
                Type::Void,
                loc,
            )?));
        }
        // `lfence` and `sfence` order nothing that ordinary loads and stores need ordered,
        // but the compiler must not move memory accesses across them.
        let clobbers_memory = clobbers_memory
            || (x86
                && instructions
                    .iter()
                    .any(|(m, _)| &m[..] == b"lfence" || &m[..] == b"sfence"));
        // Directives that only place the code that follows.
        let placement: &[&[u8]] = &[b".p2align", b".align", b".balign"];
        // (`rep; nop` and `rep nop` spell `pause`; before anything else `rep` is a prefix.)
        let only_hints = instructions.iter().all(|(m, a)| {
            let repeats_something = &m[..] == b"rep" && !a.is_empty() && &a[..] != b"nop";
            (is(m, hints) && !repeats_something) || is(m, placement)
        });
        let xgetbv = x86
            && match instructions.as_slice() {
                [(m, _)] if &m[..] == b"xgetbv" => true,
                [(m, bytes)] => &m[..] == b".byte" && &bytes[..] == b"0x0f,0x01,0xd0",
                _ => false,
            };
        let cpuid_at = instructions.iter().position(|(m, _)| &m[..] == b"cpuid");
        let cpuid = x86
            && cpuid_at.is_some()
            && instructions.iter().all(|(m, _)| {
                &m[..] == b"cpuid"
                    || [&b"push"[..], b"pop", b"mov", b"xchg"]
                        .iter()
                        .any(|prefix| m.starts_with(prefix))
            });
        // `divq`/`mulq`: the 128-by-64-bit divide and 64-by-64-bit multiply that C cannot say.
        let wide_arithmetic = x86
            && matches!(instructions.as_slice(), [(m, _)] if &m[..] == b"divq" || &m[..] == b"mulq");
        if wide_arithmetic {
            let divide = &instructions[0].0[..] == b"divq";
            let mut stmts = Vec::new();
            self.lower_wide_arithmetic(divide, outputs, inputs, &mut stmts, loc)?;
            return Ok(Stmt::Block(stmts));
        }
        // AArch64 `rbit %w0, %w1` / `rbit %0, %1`: the bit reversal C cannot say, which the
        // compression libraries write this way when the compiler says it is GNU C.
        let bit_reversal = !x86
            && matches!(instructions.as_slice(), [(m, _)] if &m[..] == b"rbit")
            && outputs.len() == 1
            && inputs.len() == 1
            && matches!(outputs[0].0.as_slice(), b"=r" | b"=&r")
            && inputs[0].0 == b"r";
        if bit_reversal {
            let (_, output) = outputs.swap_remove(0);
            let (_, input) = inputs.swap_remove(0);
            let wide = instructions[0].1.first() != Some(&b'w');
            let (bits, name) = if wide {
                (64, "rbit (64-bit)")
            } else {
                (32, "rbit (32-bit)")
            };
            let reversed = self.sema.bitreverse_builtin(bits, name, vec![input], loc)?;
            let target = self.sema.rvalue_type(&output.ty);
            let reversed = self.sema.cast(reversed, &target, loc)?;
            return Ok(Stmt::Expr(self.sema.assign(output, reversed, loc)?));
        }
        if only_hints && !outputs.is_empty() {
            // Nothing executes: the statement is there to keep the compiler from knowing
            // where a value came from. "+r"(x) leaves x as it is; "=r"(x) : "0"(y) copies.
            let mut stmts = Vec::new();
            let mut inputs: Vec<Option<(Vec<u8>, Expr)>> = inputs.into_iter().map(Some).collect();
            for (index, (constraint, output)) in outputs.into_iter().enumerate() {
                if constraint.first() == Some(&b'+') {
                    continue;
                }
                let tied = inputs.iter_mut().find(|input| {
                    matches!(input, Some((c, _)) if matches!(c.as_slice(), [d @ b'0'..=b'9'] if usize::from(d - b'0') == index))
                });
                if let Some((_, value)) = tied.and_then(Option::take) {
                    stmts.push(Stmt::Expr(self.sema.assign(output, value, loc)?));
                }
            }
            let rest: Vec<Expr> = inputs.into_iter().flatten().map(|(_, e)| e).collect();
            if !rest.is_empty() {
                stmts.push(Stmt::Expr(self.sema.discard_all(rest, loc)?));
            }
            if clobbers_memory {
                stmts.push(Stmt::Expr(self.sema.mk(
                    ExprKind::Intrinsic(Intrinsic::Barrier, Vec::new()),
                    Type::Void,
                    loc,
                )?));
            }
            return Ok(Stmt::Block(stmts));
        }
        if !only_hints && !cpuid && !xgetbv {
            if x86 {
                return self.lower_general_asm(
                    &template,
                    operand_names,
                    outputs,
                    &inputs,
                    &clobber_list,
                    is_volatile,
                    loc,
                );
            }
            let first = instructions.first().map_or(String::new(), |(m, _)| {
                format!(" ('{}')", crate::token::display_bytes(m))
            });
            return err(loc, format!("inline assembly is not supported yet{first}"));
        }
        let mut stmts = Vec::new();
        if xgetbv {
            for (_, input) in inputs {
                stmts.push(Stmt::Expr(self.sema.discard_all(vec![input], loc)?));
            }
            for (_, output) in outputs {
                let zero = self.sema.int_lit(0, Type::Int, loc)?;
                stmts.push(Stmt::Expr(self.sema.assign(output, zero, loc)?));
            }
        } else if let (true, Some(at)) = (cpuid, cpuid_at) {
            self.lower_cpuid(&instructions[at + 1..], outputs, inputs, &mut stmts, loc)?;
        } else if !inputs.is_empty() {
            let inputs = inputs.into_iter().map(|(_, e)| e).collect();
            stmts.push(Stmt::Expr(self.sema.discard_all(inputs, loc)?));
        }
        if clobbers_memory {
            stmts.push(Stmt::Expr(self.sema.mk(
                ExprKind::Intrinsic(Intrinsic::Barrier, Vec::new()),
                Type::Void,
                loc,
            )?));
        }
        Ok(Stmt::Block(stmts))
    }

    /// Any other x86-64 `asm` statement: a register is chosen for each operand, the template is
    /// assembled with those registers in it, and the statement becomes an instruction that
    /// carries the machine code and says which value goes in which register.
    #[allow(clippy::too_many_arguments)]
    fn lower_general_asm(
        &mut self,
        template: &[u8],
        names: [Vec<Option<Vec<u8>>>; 2],
        outputs: Vec<(Vec<u8>, Expr)>,
        inputs: &[(Vec<u8>, Expr)],
        clobbers: &[Vec<u8>],
        is_volatile: bool,
        loc: Loc,
    ) -> Res<Stmt> {
        use crate::asm_stmt::{OperandInfo, Source, ValueClass};
        let [output_names, input_names] = names;
        let describe =
            |parser: &Self, name: Option<Vec<u8>>, constraint: &[u8], e: &Expr| -> OperandInfo {
                let ty = parser.sema.rvalue_type(&e.ty);
                let class = if ty.is_integer() || ty.is_ptr() {
                    ValueClass::Integer
                } else if ty.is_float() {
                    ValueClass::Floating
                } else if ty.is_vector() {
                    ValueClass::Vector
                } else {
                    ValueClass::Other
                };
                let constant = if class == ValueClass::Integer && parser.sema.is_constant(e) {
                    parser.sema.const_int(e).ok()
                } else {
                    None
                };
                OperandInfo {
                    name,
                    constraint: constraint.to_vec(),
                    class,
                    size: parser.sema.tcx.size_of(&ty).unwrap_or(0),
                    constant,
                    pinned: None,
                }
            };
        let output_info: Vec<OperandInfo> = outputs
            .iter()
            .zip(output_names)
            .map(|((constraint, e), name)| describe(self, name, constraint, e))
            .collect();
        let input_info: Vec<OperandInfo> = inputs
            .iter()
            .zip(input_names)
            .map(|((constraint, e), name)| describe(self, name, constraint, e))
            .collect();
        let unique = self.sema.asm_blocks.len() as u32;
        let plan = match crate::asm_stmt::plan(
            template,
            &output_info,
            &input_info,
            clobbers,
            is_volatile,
            unique,
        ) {
            Ok(plan) => plan,
            Err(message) => {
                let message = if message.starts_with("inline assembly") {
                    message
                } else {
                    format!("inline assembly: {message}")
                };
                // An error only if the statement is ever compiled: system headers define inline
                // functions with assembly this cannot assemble, and few programs call them.
                return Ok(Stmt::Expr(self.sema.mk(
                    ExprKind::Unsupported(Rc::from(message)),
                    Type::Void,
                    loc,
                )?));
            }
        };

        // What a value in a register is: narrow integers are widened the way an argument would be.
        let register_value = |parser: &mut Self, e: Expr| -> Res<Expr> {
            let ty = parser.sema.rvalue_type(&e.ty);
            if ty.is_integer() && parser.sema.tcx.size_of(&ty).is_some_and(|size| size < 4) {
                return parser
                    .sema
                    .assign_convert(e, &Type::Int, loc, "passing an asm operand");
            }
            parser.sema.rvalue(e)
        };
        let mut arguments: Vec<Expr> = Vec::new();
        let mut input_registers: Vec<u8> = Vec::new();
        for (source, register) in &plan.inputs {
            let value = match *source {
                Source::Input(n) => register_value(self, inputs[n].1.clone())?,
                Source::Output(n) => register_value(self, outputs[n].1.clone())?,
                Source::InputAddress(n) => self.sema.addr_of(inputs[n].1.clone(), loc)?,
                Source::OutputAddress(n) => self.sema.addr_of(outputs[n].1.clone(), loc)?,
            };
            arguments.push(value);
            input_registers.push(*register);
        }
        // Each register output lands in a temporary of the register's type, then is assigned to
        // the operand like any other value, which converts it.
        let mut results: Vec<(AsmResult, u8)> = Vec::new();
        let mut assignments: Vec<(usize, LocalId, Type)> = Vec::new();
        for (n, register) in &plan.outputs {
            let info = &output_info[*n];
            let (result, ty) = match (info.class, info.size) {
                (ValueClass::Integer, 8) => (AsmResult::I64, Type::ULLong),
                (ValueClass::Integer, _) => (AsmResult::I32, Type::UInt),
                (ValueClass::Floating, 4) => (AsmResult::F32, Type::Float),
                (ValueClass::Floating, 8) => (AsmResult::F64, Type::Double),
                _ => {
                    return err(
                        outputs[*n].1.loc,
                        "inline assembly: an output of this type cannot be in a register",
                    );
                }
            };
            let local = self.sema.new_local(ty.clone());
            let place = self.sema.mk(ExprKind::Local(local), ty.clone(), loc)?;
            arguments.push(self.sema.addr_of(place, loc)?);
            results.push((result, *register));
            assignments.push((*n, local, ty));
        }
        let index = self.sema.asm_blocks.len() as u32;
        self.sema.asm_blocks.push(AsmBlock {
            side_effects: plan.side_effects,
            code: plan.code,
            input_registers,
            outputs: results,
            clobbers: plan.clobbers,
        });
        let mut stmts = vec![Stmt::Expr(self.sema.mk(
            ExprKind::Intrinsic(Intrinsic::InlineAsm(index), arguments),
            Type::Void,
            loc,
        )?)];
        let mut outputs: Vec<Option<Expr>> = outputs.into_iter().map(|(_, e)| Some(e)).collect();
        for (n, local, ty) in assignments {
            let Some(output) = outputs[n].take() else {
                return err(loc, "inline assembly: an output is written twice");
            };
            let temporary = self.sema.mk(ExprKind::Local(local), ty, loc)?;
            let value = self.sema.rvalue(temporary)?;
            let target = self.sema.rvalue_type(&output.ty);
            let value = self.sema.cast(value, &target, loc)?;
            stmts.push(Stmt::Expr(self.sema.assign(output, value, loc)?));
        }
        Ok(Stmt::Block(stmts))
    }

    /// `asm("divq %2" : "=a"(quotient), "=d"(remainder) : "r"(divisor), "a"(low), "d"(high))`
    /// and `asm("mulq %3" : "=a"(low), "=d"(high) : "a"(x), "rm"(y))`.
    fn lower_wide_arithmetic(
        &mut self,
        divide: bool,
        outputs: Vec<(Vec<u8>, Expr)>,
        inputs: Vec<(Vec<u8>, Expr)>,
        stmts: &mut Vec<Stmt>,
        loc: Loc,
    ) -> Res<()> {
        let what = if divide { "divq" } else { "mulq" };
        let unsupported = |detail: &str| -> Res<()> {
            err(
                loc,
                format!("inline assembly is not supported yet ('{what}' with {detail})"),
            )
        };
        // a, d, or anything else (the instruction's explicit operand).
        let register = |constraint: &[u8]| -> u8 {
            let mut found = b'r';
            for &c in constraint {
                if c == b'a' || c == b'd' {
                    found = c;
                }
            }
            found
        };
        let mut a_out = None;
        let mut d_out = None;
        let mut output_registers = Vec::new();
        for (constraint, e) in outputs {
            let r = register(&constraint);
            output_registers.push(r);
            match r {
                b'a' if a_out.is_none() => a_out = Some(e),
                b'd' if d_out.is_none() => d_out = Some(e),
                _ => return unsupported("an output that is neither rax nor rdx"),
            }
        }
        let (Some(a_out), Some(d_out)) = (a_out, d_out) else {
            return unsupported("outputs other than rax and rdx");
        };
        let word = Type::ULLong;
        let (mut a_in, mut d_in, mut operand) = (None, None, None);
        for (constraint, e) in inputs {
            // `%` says the operand commutes with the next one; a digit ties it to an output.
            let constraint: Vec<u8> = constraint.into_iter().filter(|&c| c != b'%').collect();
            let r = match constraint.as_slice() {
                [digit @ b'0'..=b'9'] => output_registers
                    .get(usize::from(digit - b'0'))
                    .copied()
                    .unwrap_or(b'r'),
                other => register(other),
            };
            let value = self
                .sema
                .assign_convert(e, &word, loc, "passing an argument")?;
            let slot = match r {
                b'a' => &mut a_in,
                b'd' => &mut d_in,
                _ => &mut operand,
            };
            if slot.is_some() {
                return unsupported("two inputs in one register");
            }
            *slot = Some(value);
        }
        let (Some(a_in), Some(operand)) = (a_in, operand) else {
            return unsupported("no input in rax, or no operand");
        };
        // Every input is read before an output is written.
        let mut keep = |parser: &mut Self, value: Expr| -> Res<LocalId> {
            let local = parser.sema.new_local(word.clone());
            let target = parser.sema.mk(ExprKind::Local(local), word.clone(), loc)?;
            let store = parser.sema.assign(target, value, loc)?;
            stmts.push(Stmt::Expr(store));
            Ok(local)
        };
        let ta = keep(self, a_in)?;
        let tv = keep(self, operand)?;
        let td = match d_in {
            Some(high) => Some(keep(self, high)?),
            None => None,
        };
        let read = |parser: &Self, local: LocalId| -> Res<Expr> {
            let place = parser.sema.mk(ExprKind::Local(local), word.clone(), loc)?;
            parser.sema.rvalue(place)
        };
        if divide {
            let Some(td) = td else {
                return unsupported("no high half in rdx");
            };
            let wide = Type::UInt128;
            let high = read(self, td)?;
            let high = self.sema.convert(high, &wide, loc)?;
            let by = self.sema.int_lit(64, Type::Int, loc)?;
            let high = self.sema.binary(BinOp::Shl, high, by, loc)?;
            let low = read(self, ta)?;
            let low = self.sema.convert(low, &wide, loc)?;
            let dividend = self.sema.binary(BinOp::Or, high, low, loc)?;
            let dividend_local = self.sema.new_local(wide.clone());
            let target = self
                .sema
                .mk(ExprKind::Local(dividend_local), wide.clone(), loc)?;
            stmts.push(Stmt::Expr(self.sema.assign(target, dividend, loc)?));
            for (op, out) in [(BinOp::Div, a_out), (BinOp::Rem, d_out)] {
                let place = self
                    .sema
                    .mk(ExprKind::Local(dividend_local), wide.clone(), loc)?;
                let dividend = self.sema.rvalue(place)?;
                let divisor = read(self, tv)?;
                let divisor = self.sema.convert(divisor, &wide, loc)?;
                let result = self.sema.binary(op, dividend, divisor, loc)?;
                let result = self.sema.convert(result, &word, loc)?;
                stmts.push(Stmt::Expr(self.sema.assign(out, result, loc)?));
            }
        } else {
            let (x, y) = (read(self, ta)?, read(self, tv)?);
            let high = self.sema.mk(
                ExprKind::Intrinsic(Intrinsic::MulHigh, vec![x, y]),
                word.clone(),
                loc,
            )?;
            let high_local = keep(self, high)?;
            let (x, y) = (read(self, ta)?, read(self, tv)?);
            let low = self.sema.binary(BinOp::Mul, x, y, loc)?;
            stmts.push(Stmt::Expr(self.sema.assign(a_out, low, loc)?));
            let high = read(self, high_local)?;
            stmts.push(Stmt::Expr(self.sema.assign(d_out, high, loc)?));
        }
        Ok(())
    }

    /// The `cpuid` idiom. `after` is what follows the instruction: moves out of `ebx`, which
    /// code that must not clobber it uses to hand its value over in another register.
    fn lower_cpuid(
        &mut self,
        after: &[(Vec<u8>, Vec<u8>)],
        outputs: Vec<(Vec<u8>, Expr)>,
        inputs: Vec<(Vec<u8>, Expr)>,
        stmts: &mut Vec<Stmt>,
        loc: Loc,
    ) -> Res<()> {
        // The register an operand lives in, from its constraint: a b c d S D.
        let register = |constraint: &[u8]| -> Option<u8> {
            let mut found = None;
            for &c in constraint {
                match c {
                    b'=' | b'+' | b'&' | b'%' => {}
                    b'a' | b'b' | b'c' | b'd' | b'S' | b'D' if found.is_none() => found = Some(c),
                    _ => return None,
                }
            }
            found
        };
        // Which cpuid result (0 eax, 1 ebx, 2 ecx, 3 edx) each register holds at the end.
        let mut holds: Vec<(u8, usize)> = vec![(b'a', 0), (b'b', 1), (b'c', 2), (b'd', 3)];
        let named = |text: &[u8]| -> Option<u8> {
            Some(match text {
                b"eax" | b"rax" => b'a',
                b"ebx" | b"rbx" => b'b',
                b"ecx" | b"rcx" => b'c',
                b"edx" | b"rdx" => b'd',
                b"esi" | b"rsi" => b'S',
                b"edi" | b"rdi" => b'D',
                _ => return None,
            })
        };
        for (mnemonic, arguments) in after {
            let comma = bun_core::strings::index_of_char_usize(arguments, b',');
            let pair =
                comma.and_then(|at| Some((named(&arguments[..at])?, named(&arguments[at + 1..])?)));
            let value_of = |holds: &[(u8, usize)], r: u8| {
                holds.iter().find(|(name, _)| *name == r).map(|(_, v)| *v)
            };
            if mnemonic.starts_with(b"mov") {
                let Some((from, to)) = pair else {
                    return err(
                        loc,
                        "inline assembly is not supported yet (operands of 'mov' after 'cpuid')",
                    );
                };
                let value = value_of(&holds, from);
                holds.retain(|(name, _)| *name != to);
                if let Some(value) = value {
                    holds.push((to, value));
                }
            } else if mnemonic.starts_with(b"xchg") {
                let Some((one, other)) = pair else {
                    return err(
                        loc,
                        "inline assembly is not supported yet (operands of 'xchg' after 'cpuid')",
                    );
                };
                let (first, second) = (value_of(&holds, one), value_of(&holds, other));
                holds.retain(|(name, _)| *name != one && *name != other);
                if let Some(value) = first {
                    holds.push((other, value));
                }
                if let Some(value) = second {
                    holds.push((one, value));
                }
            } else if mnemonic.starts_with(b"pop") {
                // The saved register comes back: it no longer holds a result.
                if let Some(r) = named(arguments) {
                    holds.retain(|(name, _)| *name != r);
                }
            }
        }
        // leaf in eax, subleaf in ecx; `"0"(x)` means "where output 0 is".
        let mut leaf: Option<Expr> = None;
        let mut subleaf: Option<Expr> = None;
        for (constraint, input) in inputs {
            let tied = match constraint.as_slice() {
                [digit @ b'0'..=b'9'] => outputs
                    .get(usize::from(digit - b'0'))
                    .and_then(|(c, _)| register(c)),
                other => register(other),
            };
            match tied {
                Some(b'a') if leaf.is_none() => leaf = Some(input),
                Some(b'c') if subleaf.is_none() => subleaf = Some(input),
                _ => {
                    return err(
                        input.loc,
                        "inline assembly is not supported yet (an input of 'cpuid' that is neither eax nor ecx)",
                    );
                }
            }
        }
        let Some(leaf) = leaf else {
            return err(
                loc,
                "inline assembly is not supported yet ('cpuid' without a leaf in eax)",
            );
        };
        let unsigned = Type::UInt;
        let leaf = self
            .sema
            .assign_convert(leaf, &unsigned, loc, "passing an argument")?;
        let subleaf = match subleaf {
            Some(e) => self
                .sema
                .assign_convert(e, &unsigned, loc, "passing an argument")?,
            None => self.sema.int_lit(0, unsigned.clone(), loc)?,
        };
        let results = Type::Array(Rc::new(unsigned), Some(4));
        let local = self.sema.new_local(results.clone());
        let place = self.sema.mk(ExprKind::Local(local), results.clone(), loc)?;
        let address = self.sema.addr_of(place, loc)?;
        stmts.push(Stmt::Expr(self.sema.mk(
            ExprKind::Intrinsic(Intrinsic::CpuId, vec![leaf, subleaf, address]),
            Type::Void,
            loc,
        )?));
        for (constraint, output) in outputs {
            let Some(r) = register(&constraint) else {
                return err(
                    output.loc,
                    "inline assembly is not supported yet (an output of 'cpuid' that is not in a named register)",
                );
            };
            let Some(which) = holds.iter().find(|(name, _)| *name == r).map(|(_, v)| *v) else {
                return err(output.loc, "this output of 'cpuid' is never written");
            };
            let array = self.sema.mk(ExprKind::Local(local), results.clone(), loc)?;
            let index = self.sema.int_lit(which as i64, Type::Int, loc)?;
            let element = self.sema.index(array, index, loc)?;
            let value = self.sema.rvalue(element)?;
            stmts.push(Stmt::Expr(self.sema.assign(output, value, loc)?));
        }
        Ok(())
    }

    /// A label at the current position, if there is one: `name:`, `case value:`,
    /// `case low ... high:` (GNU) or `default:`.
    #[inline(never)]
    fn parse_label(&mut self, of_the_switch: &mut Option<LabelId>) -> Res<Option<LabelId>> {
        let loc = self.loc();
        match self.cur.tok.clone() {
            Tok::Ident(name) if matches!(self.peek2()?, Tok::Punct(Punct::Colon)) => {
                self.bump()?;
                self.bump()?;
                let label = self.sema.named_label(&name, true, loc)?;
                self.sema.set_label_vla_path(label, &self.vla_path);
                Ok(Some(label))
            }
            Tok::Kw(Kw::Case) => {
                self.bump()?;
                let e = self.parse_conditional()?;
                let value = self.sema.const_int(&e)?;
                let mut high = value;
                if self.eat(Punct::Ellipsis)? {
                    let e = self.parse_conditional()?;
                    high = self.sema.const_int(&e)?;
                }
                self.expect(Punct::Colon)?;
                let label = self.switch_label(of_the_switch);
                let Some(ctx) = self.switches.last_mut() else {
                    return err(loc, "'case' label not within a switch statement");
                };
                if ctx.vla_path != self.vla_path {
                    return err(
                        loc,
                        "switch jumps into the scope of a variable length array",
                    );
                }
                let value = self.sema.wrap_int(value, &ctx.cond_ty);
                let high = self.sema.wrap_int(high, &ctx.cond_ty);
                // In the order of the controlling expression's type.
                let key = |v: i64| {
                    if self.sema.tcx.is_signed(&ctx.cond_ty) {
                        (v as u64) ^ (1 << 63)
                    } else {
                        v as u64
                    }
                };
                if key(high) < key(value) {
                    return err(loc, "empty case range");
                }
                // The ranges so far are disjoint, so only the last one that starts at or below
                // `high` can reach into this one.
                if ctx
                    .ranges
                    .range(..=key(high))
                    .next_back()
                    .is_some_and(|(_, end)| *end >= key(value))
                {
                    return err(loc, format!("duplicate case value {value}"));
                }
                ctx.ranges.insert(key(value), key(high));
                ctx.cases.push(SwitchCase { value, high, label });
                Ok(Some(label))
            }
            Tok::Kw(Kw::Default) => {
                self.bump()?;
                self.expect(Punct::Colon)?;
                let label = self.switch_label(of_the_switch);
                let Some(ctx) = self.switches.last_mut() else {
                    return err(loc, "'default' label not within a switch statement");
                };
                if ctx.vla_path != self.vla_path {
                    return err(
                        loc,
                        "switch jumps into the scope of a variable length array",
                    );
                }
                if ctx.default.is_some() {
                    return err(loc, "multiple default labels in one switch");
                }
                ctx.default = Some(label);
                Ok(Some(label))
            }
            _ => Ok(None),
        }
    }

    /// The label a `case` or `default` stands for: the one the labels before it in the same run
    /// stand for, or a new one.
    fn switch_label(&mut self, of_the_switch: &mut Option<LabelId>) -> LabelId {
        *of_the_switch.get_or_insert_with(|| {
            let label = self.sema.new_label();
            self.sema.set_label_vla_path(label, &self.vla_path);
            label
        })
    }

    /// The statement after a label. `label: }` (C23) and `label: int x;` are tolerated.
    fn parse_labeled_body(&mut self) -> Res<Stmt> {
        if self.at(Punct::RBrace) {
            return Ok(Stmt::Empty);
        }
        let bracket_attr =
            self.at(Punct::LBracket) && matches!(self.peek2()?, Tok::Punct(Punct::LBracket));
        if self.at_kw(Kw::Attribute) || bracket_attr {
            let mut ignored = Attrs::default();
            self.parse_attributes(&mut ignored)?;
            if self.eat(Punct::Semi)? {
                return Ok(Stmt::Empty);
            }
        }
        // `__extension__` starts a declaration or an expression: what follows it says.
        let extension_expression = self.at_kw(Kw::Extension)
            && !self.next_is_type_start()?
            && !matches!(
                self.peek2()?,
                Tok::Kw(
                    Kw::Static
                        | Kw::Extern
                        | Kw::Typedef
                        | Kw::Register
                        | Kw::Auto
                        | Kw::Inline
                        | Kw::Extension
                        | Kw::ThreadLocal
                        | Kw::Alignas
                        | Kw::Noreturn
                )
            );
        if self.is_type_start()
            && !extension_expression
            && !(matches!(self.cur.tok, Tok::Ident(_))
                && matches!(self.peek2()?, Tok::Punct(Punct::Colon)))
        {
            let mut stmts = Vec::new();
            self.parse_local_declaration(&mut stmts)?;
            return Ok(Stmt::Block(stmts));
        }
        self.parse_statement()
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn parse_expr(&mut self) -> Res<Expr> {
        let mut e = self.parse_assign()?;
        while self.at(Punct::Comma) {
            let loc = self.bump()?.loc;
            let rhs = self.parse_assign()?;
            e = self.sema.comma(e, rhs, loc)?;
        }
        Ok(e)
    }

    fn parse_assign(&mut self) -> Res<Expr> {
        self.enter()?;
        let lhs = self.parse_conditional()?;
        let result = if let Tok::Punct(p) = self.cur.tok {
            if p == Punct::Assign {
                let loc = self.bump()?.loc;
                let rhs = self.parse_assign()?;
                self.sema.assign(lhs, rhs, loc)?
            } else if let Some(op) = compound_assign_op(p) {
                let loc = self.bump()?.loc;
                let rhs = self.parse_assign()?;
                self.sema.compound_assign(op, lhs, rhs, loc)?
            } else {
                lhs
            }
        } else {
            lhs
        };
        self.leave();
        Ok(result)
    }

    fn parse_conditional(&mut self) -> Res<Expr> {
        let cond = self.parse_binary(1)?;
        if !self.at(Punct::Question) {
            return Ok(cond);
        }
        self.enter()?;
        let loc = self.bump()?.loc;
        if self.eat(Punct::Colon)? {
            let otherwise = self.parse_conditional()?;
            self.leave();
            return self.sema.elvis(cond, otherwise, loc);
        }
        let then = self.parse_expr()?;
        self.expect(Punct::Colon)?;
        let otherwise = self.parse_conditional()?;
        self.leave();
        self.sema.conditional(cond, then, otherwise, loc)
    }

    fn parse_binary(&mut self, min_prec: u32) -> Res<Expr> {
        let mut lhs = self.parse_cast()?;
        loop {
            let Tok::Punct(p) = self.cur.tok else { break };
            let Some((prec, op)) = binary_precedence(p) else {
                break;
            };
            if prec < min_prec {
                break;
            }
            let loc = self.bump()?.loc;
            let rhs = self.parse_binary(prec + 1)?;
            lhs = match op {
                Some(op) => self.sema.binary(op, lhs, rhs, loc)?,
                None => self.sema.logical(p == Punct::AmpAmp, lhs, rhs, loc)?,
            };
        }
        Ok(lhs)
    }

    fn parse_cast(&mut self) -> Res<Expr> {
        if self.at(Punct::LParen) && self.next_is_type_start()? {
            self.enter()?;
            let loc = self.bump()?.loc;
            let ty = self.parse_type_name()?;
            self.expect(Punct::RParen)?;
            if self.at(Punct::LBrace) {
                let literal = self.parse_compound_literal(&ty, loc)?;
                self.leave();
                return self.parse_postfix_suffixes(literal);
            }
            let operand = self.parse_cast()?;
            self.leave();
            if let Some(member) = self.union_member_for(&ty, &operand) {
                // GNU C: a cast to a union type makes a union whose member of the operand's type
                // has its value.
                let init = crate::init::Init::List(
                    vec![crate::init::InitEntry {
                        designators: vec![crate::init::Designator::Field(member, loc)],
                        init: crate::init::Init::Expr(operand),
                        loc,
                        once: None,
                    }],
                    loc,
                );
                return self.sema.compound_literal(&ty, init, loc);
            }
            let cast = self.sema.cast(operand, &ty, loc)?;
            return self.after_pending_vla(cast);
        }
        if self.at_kw(Kw::Extension) {
            self.bump()?;
            return self.parse_cast();
        }
        self.parse_unary()
    }

    /// The first named member of union type `ty` that has the type of `operand`, when `operand`
    /// is not of type `ty` already.
    fn union_member_for(&self, ty: &Type, operand: &Expr) -> Option<Rc<str>> {
        let Type::Struct(id) = ty.unqualified() else {
            return None;
        };
        let def = self.sema.tcx.struct_def(*id);
        let from = self.sema.rvalue_type(&operand.ty);
        if !def.is_union || from.unqualified() == ty.unqualified() {
            return None;
        }
        def.members()
            .iter()
            .find(|m| {
                m.bitfield.is_none() && Sema::compatible(m.ty.unqualified(), from.unqualified())
            })
            .and_then(|m| m.name.clone())
    }

    /// The braces of `(type){ ... }`; the parenthesized type has been consumed.
    fn parse_compound_literal(&mut self, ty: &Type, loc: Loc) -> Res<Expr> {
        let init = self.parse_initializer()?;
        self.sema.compound_literal(ty, init, loc)
    }

    fn parse_unary(&mut self) -> Res<Expr> {
        let loc = self.loc();
        if let Tok::Ident(name) = &self.cur.tok {
            let imag = matches!(&**name, "__imag__" | "__imag");
            if (imag || matches!(&**name, "__real__" | "__real"))
                && self.sema.lookup(name).is_none()
            {
                self.enter()?;
                self.bump()?;
                let operand = self.parse_cast()?;
                self.leave();
                return self.sema.complex_part(operand, imag, loc);
            }
        }
        let Tok::Punct(p) = self.cur.tok else {
            return match self.cur.tok {
                Tok::Kw(Kw::Sizeof) => self.parse_sizeof(false),
                Tok::Kw(Kw::Alignof) => self.parse_sizeof(true),
                _ => self.parse_postfix(),
            };
        };
        if p == Punct::AmpAmp {
            // GNU labels as values: `&&label`.
            self.bump()?;
            let (name, nloc) = self.expect_ident()?;
            return self.sema.label_address(&name, nloc);
        }
        if !matches!(
            p,
            Punct::PlusPlus
                | Punct::MinusMinus
                | Punct::Amp
                | Punct::Star
                | Punct::Plus
                | Punct::Minus
                | Punct::Tilde
                | Punct::Bang
        ) {
            return self.parse_postfix();
        }
        self.enter()?;
        self.bump()?;
        let result = match p {
            Punct::PlusPlus | Punct::MinusMinus => {
                let operand = self.parse_unary()?;
                self.sema
                    .inc_dec(operand, step_of(p), crate::sema::Fix::Prefix, loc)
            }
            _ => {
                let operand = self.parse_cast()?;
                match p {
                    Punct::Amp => self.sema.addr_of(operand, loc),
                    Punct::Star => self.sema.deref(operand, loc),
                    Punct::Plus => self.sema.unary_plus(operand, loc),
                    Punct::Minus => self.sema.neg(operand, loc),
                    Punct::Tilde => self.sema.bit_not(operand, loc),
                    _ => self.sema.log_not(operand, loc),
                }
            }
        };
        self.leave();
        result
    }

    fn parse_sizeof(&mut self, is_alignof: bool) -> Res<Expr> {
        self.enter()?;
        let loc = self.bump()?.loc;
        // `__alignof__(variable)`: what its declaration asked for, if more than its type does.
        let mut declared_align = None;
        let first_new_vla = self.sema.vlas.len();
        let ty = if self.at(Punct::LParen) && self.next_is_type_start()? {
            self.bump()?;
            let ty = self.parse_type_name()?;
            self.expect(Punct::RParen)?;
            if self.at(Punct::LBrace) {
                let literal = self.parse_compound_literal(&ty, loc)?;
                self.parse_postfix_suffixes(literal)?.ty
            } else {
                ty
            }
        } else {
            // The operand is not evaluated and does not decay.
            let operand = self.parse_unary()?;
            if matches!(operand.kind, ExprKind::BitField { .. }) {
                return err(
                    loc,
                    format!(
                        "invalid application of '{}' to a bit-field",
                        if is_alignof { "_Alignof" } else { "sizeof" }
                    ),
                );
            }
            declared_align = match operand.kind {
                ExprKind::Global(id) => self.sema.globals.get(id as usize).and_then(|g| g.align),
                ExprKind::Local(id) => self
                    .sema
                    .func
                    .as_ref()
                    .and_then(|f| f.locals.get(id as usize))
                    .and_then(|l| l.align),
                _ => None,
            };
            operand.ty
        };
        self.leave();
        if is_alignof {
            let natural = self.sema.tcx.align_of(&ty).unwrap_or(1);
            if let Some(declared) = declared_align.filter(|&a| a > natural) {
                return self
                    .sema
                    .int_lit(declared as i64, self.sema.size_type(), loc);
            }
            self.sema.alignof_type(&ty, loc)
        } else {
            // `sizeof(int[n])` evaluates `n`, and so does `sizeof *(int (*)[n])p`, whose operand is
            // otherwise not evaluated: the bounds its type names are all of it that is.
            if self.sema.tcx.is_variably_sized(&ty) {
                let mut bounds = self.sema.vla_bounds_since(first_new_vla, loc)?;
                self.pending_vla.clear();
                self.pending_vla.append(&mut bounds);
            }
            let size = self.sema.sizeof_type(&ty, loc)?;
            self.after_pending_vla(size)
        }
    }

    fn parse_postfix(&mut self) -> Res<Expr> {
        let e = self.parse_primary()?;
        self.parse_postfix_suffixes(e)
    }

    fn parse_postfix_suffixes(&mut self, mut e: Expr) -> Res<Expr> {
        loop {
            let Tok::Punct(p) = self.cur.tok else { break };
            match p {
                Punct::LBracket => {
                    let loc = self.bump()?.loc;
                    let index = self.parse_expr()?;
                    self.expect(Punct::RBracket)?;
                    e = self.sema.index(e, index, loc)?;
                }
                Punct::LParen => {
                    let loc = self.bump()?.loc;
                    let mut args = Vec::new();
                    if !self.at(Punct::RParen) {
                        loop {
                            args.push(self.parse_assign()?);
                            if !self.eat(Punct::Comma)? {
                                break;
                            }
                        }
                    }
                    self.expect(Punct::RParen)?;
                    e = self.sema.call(e, args, loc)?;
                }
                Punct::Dot | Punct::Arrow => {
                    let loc = self.bump()?.loc;
                    let (name, _) = self.expect_ident()?;
                    e = self.sema.member(e, &name, p == Punct::Arrow, loc)?;
                }
                Punct::PlusPlus | Punct::MinusMinus => {
                    let loc = self.bump()?.loc;
                    e = self
                        .sema
                        .inc_dec(e, step_of(p), crate::sema::Fix::Postfix, loc)?;
                }
                _ => break,
            }
        }
        Ok(e)
    }

    /// An identifier in an expression: a variable, a function, an enumerator, or a builtin
    /// that is called like one.
    #[inline(never)]
    fn parse_identifier(&mut self, name: &Rc<str>, loc: Loc) -> Res<Expr> {
        self.bump()?;
        if self.at(Punct::LParen) && self.sema.is_alloca_builtin(name) {
            let mut args = self.parse_builtin_args()?;
            let with_align = &**name == "__builtin_alloca_with_align";
            if args.len() != 1 + usize::from(with_align) {
                return err(loc, format!("wrong number of arguments to {name}"));
            }
            let align = if with_align {
                let bits = self.sema.const_int(&args[1])?;
                if bits < 8 || !(bits as u64).is_power_of_two() {
                    return err(
                        loc,
                        "the alignment of __builtin_alloca_with_align must be a power of two number of bits",
                    );
                }
                self.check_alignment_limit(bits as u64 / 8, loc)?;
                (bits as u64 / 8).max(16)
            } else {
                16
            };
            return self.sema.alloca(args.swap_remove(0), align, loc);
        }
        if self.dialect.microsoft && self.at(Punct::LParen) {
            if let Some(e) = self.parse_microsoft_call(name, loc)? {
                return Ok(e);
            }
        }
        if self.sema.lookup(name).is_none() {
            if let Some(e) = self.parse_builtin(name, loc)? {
                return Ok(e);
            }
            if self.at(Punct::LParen) {
                return err(
                    loc,
                    format!(
                        "call to undeclared function '{name}'; implicit function declarations are not allowed"
                    ),
                );
            }
        }
        self.sema.ident(name, loc)
    }

    /// A string literal and the ones that follow it.
    #[inline(never)]
    fn parse_string_literals(&mut self, loc: Loc) -> Res<Expr> {
        // Adjacent string literals concatenate (translation phase 6); one wide part
        // makes the whole literal wide.
        let mut narrow: Vec<u8> = Vec::new();
        let mut points: Vec<u32> = Vec::new();
        let mut wide = None;
        let mut utf8_prefixed = false;
        loop {
            match &self.cur.tok {
                Tok::Str(part, escaped, utf8) => {
                    utf8_prefixed |= utf8.0;
                    narrow.extend_from_slice(part);
                    // Source characters become their code points; a byte written as an
                    // escape is one element.
                    let mut from = 0;
                    for &at in escaped.iter().chain(std::iter::once(&(part.len() as u32))) {
                        let run = &part[from..at as usize];
                        points.extend(crate::token::display_bytes(run).chars().map(|c| c as u32));
                        if let Some(&byte) = part.get(at as usize) {
                            points.push(u32::from(byte));
                        }
                        from = at as usize + 1;
                    }
                }
                Tok::WideStr(kind, part) => {
                    if wide.is_some_and(|k| k != *kind) {
                        return err(
                            self.loc(),
                            "concatenation of string literals with different prefixes",
                        );
                    }
                    wide = Some(*kind);
                    points.extend_from_slice(part);
                }
                _ => break,
            }
            self.bump()?;
        }
        if wide.is_some() && utf8_prefixed {
            return err(
                loc,
                "concatenation of string literals with different prefixes",
            );
        }
        match wide {
            Some(kind) => {
                let elem = self.sema.wide_elem_type(kind);
                self.sema.wide_string_lit(&points, elem, loc)
            }
            None => self.sema.string_lit(narrow, loc),
        }
    }

    fn parse_primary(&mut self) -> Res<Expr> {
        let loc = self.loc();
        match &self.cur.tok {
            Tok::Ident(name) => {
                let name = Rc::clone(name);
                self.parse_identifier(&name, loc)
            }
            Tok::Int {
                value,
                decimal,
                suffix,
            } => {
                let (value, decimal, suffix) = (*value, *decimal, *suffix);
                self.bump()?;
                self.sema.int_constant(value, decimal, suffix, loc)
            }
            Tok::Float {
                value,
                single,
                long_double,
                imaginary,
            } => {
                let (value, single, imaginary) = (*value, *single, *imaginary);
                let has_long_suffix = long_double.is_some();
                let extended =
                    long_double.filter(|_| self.sema.tcx.target.long_double_size().is_some());
                self.bump()?;
                if let Some(extended) = extended {
                    if !self.sema.tcx.target.long_double_is_x87() || imaginary {
                        return err(
                            loc,
                            "computing with values of type 'long double' is not supported yet",
                        );
                    }
                    return self.sema.long_double_lit(extended, loc);
                }
                let ty = if single {
                    Type::Float
                } else if has_long_suffix && !imaginary {
                    Type::LongDouble64
                } else {
                    Type::Double
                };
                if imaginary {
                    return self.sema.imaginary_lit(value, &ty, loc);
                }
                self.sema.float_lit(value, ty, loc)
            }
            Tok::Char(value) => {
                let value = *value;
                self.bump()?;
                self.sema.int_lit(value, Type::Int, loc)
            }
            Tok::WideChar(kind, value) => {
                let (kind, value) = (*kind, *value);
                self.bump()?;
                let ty = self.sema.wide_elem_type(kind);
                self.sema.int_lit(i64::from(value), ty, loc)
            }
            Tok::Str(..) | Tok::WideStr(..) => self.parse_string_literals(loc),
            Tok::Punct(Punct::LParen) => {
                self.enter()?;
                self.bump()?;
                if self.at(Punct::LBrace) {
                    let e = self.parse_statement_expr(loc)?;
                    self.leave();
                    return Ok(e);
                }
                let e = self.parse_expr()?;
                self.expect(Punct::RParen)?;
                self.leave();
                Ok(e)
            }
            Tok::Kw(Kw::Generic) => self.parse_generic(),
            Tok::NotANumber(message) => err(loc, message.to_string()),
            other => err(
                loc,
                format!("expected an expression before {}", other.describe()),
            ),
        }
    }

    /// `({ ... })`; the opening parenthesis has been consumed.
    /// `value`, after the operands of a builtin that only it is the value of: they are
    /// evaluated like any argument, unless they are constants (which leaves `value` one).
    fn after_evaluating(&mut self, operands: Vec<Expr>, value: Expr, loc: Loc) -> Res<Expr> {
        let evaluated: Vec<Expr> = operands
            .into_iter()
            .filter(|operand| !self.sema.constant_p(operand))
            .collect();
        if evaluated.is_empty() {
            return Ok(value);
        }
        let before = self.sema.discard_all(evaluated, loc)?;
        self.sema.comma(before, value, loc)
    }

    fn parse_statement_expr(&mut self, loc: Loc) -> Res<Expr> {
        if self.sema.func.is_none() {
            return err(
                loc,
                "a statement expression is only allowed inside a function",
            );
        }
        self.bump()?;
        self.sema.push_scope();
        let stmts = self.parse_block_items()?;
        self.sema.pop_scope();
        self.expect(Punct::RParen)?;
        self.sema.statement_expr(stmts, loc)
    }

    /// `_Generic(controlling, type: expr, ..., default: expr)`.
    fn parse_generic(&mut self) -> Res<Expr> {
        let loc = self.bump()?.loc;
        self.expect(Punct::LParen)?;
        let controlling = self.parse_assign()?;
        // The controlling expression is not evaluated; its type is taken after lvalue
        // conversion and decay.
        let control_ty = self.sema.rvalue_type(&controlling.ty);
        let mut chosen: Option<Expr> = None;
        let mut fallback: Option<Expr> = None;
        let mut named: Vec<Type> = Vec::new();
        while self.eat(Punct::Comma)? {
            let is_default = self.eat_kw(Kw::Default)?;
            let at = self.loc();
            let ty = if is_default {
                None
            } else {
                Some(self.parse_type_name()?)
            };
            self.expect(Punct::Colon)?;
            let value = self.parse_assign()?;
            match ty {
                None if fallback.is_some() => return err(loc, "duplicate default in _Generic"),
                None => fallback = Some(value),
                Some(ty) => {
                    if ty.is_func()
                        || !self.sema.tcx.is_complete(&ty)
                        || self.sema.tcx.is_variably_sized(&ty)
                    {
                        return err(
                            at,
                            format!(
                                "_Generic names type '{}', which is not a complete object type of known constant size",
                                self.sema.tcx.display(&ty)
                            ),
                        );
                    }
                    if let Some(earlier) =
                        named.iter().find(|earlier| Sema::compatible(earlier, &ty))
                    {
                        return err(
                            at,
                            format!(
                                "_Generic names type '{}', which is compatible with '{}' named before it",
                                self.sema.tcx.display(&ty),
                                self.sema.tcx.display(earlier)
                            ),
                        );
                    }
                    if chosen.is_none() && Sema::compatible(&ty, &control_ty) {
                        chosen = Some(value);
                    }
                    named.push(ty);
                }
            }
        }
        self.expect(Punct::RParen)?;
        match chosen.or(fallback) {
            Some(e) => Ok(e),
            None => err(
                loc,
                format!(
                    "_Generic selector of type '{}' is not compatible with any association",
                    self.sema.tcx.display(&control_ty)
                ),
            ),
        }
    }

    /// Builtins that are part of the language as far as headers are concerned. Returns
    /// `None` if `name` is not one of them.
    fn parse_builtin(&mut self, name: &str, loc: Loc) -> Res<Option<Expr>> {
        // (Microsoft's rotates aside, which are functions of its headers elsewhere.)
        let microsoft = !name.starts_with("__");
        if !microsoft && !crate::pp_expr::has_builtin(name, self.sema.tcx.target) {
            return Ok(None);
        }
        if name.starts_with("__atomic_")
            || name.starts_with("__sync_")
            || name.starts_with("__c11_atomic_")
        {
            return self.parse_atomic_builtin(name, loc);
        }
        // The Microsoft spellings, which GCC's <x86intrin.h> has too.
        let long_bits = self.sema.tcx.target.long_size() as u32 * 8;
        let microsoft_rotate = match name {
            "_rotl" => Some((true, 32)),
            "_rotr" => Some((false, 32)),
            "_lrotl" => Some((true, long_bits)),
            "_lrotr" => Some((false, long_bits)),
            "_rotl64" => Some((true, 64)),
            "_rotr64" => Some((false, 64)),
            _ => None,
        };
        if let (Some((left, bits)), true) = (microsoft_rotate, self.at(Punct::LParen)) {
            let args = self.parse_builtin_args()?;
            return Ok(Some(self.sema.rotate_builtin(left, bits, name, args, loc)?));
        }
        let Some(short) = name.strip_prefix("__builtin_") else {
            return Ok(None);
        };
        if let Some(e) = self.parse_vector_builtin(name, short, loc)? {
            return Ok(Some(e));
        }
        let uint = Type::UInt;
        let (ulong, ullong) = (Type::ULong, Type::ULLong);
        match short {
            "offsetof" => {
                self.expect(Punct::LParen)?;
                let ty = self.parse_type_name()?;
                self.expect(Punct::Comma)?;
                // Walk the member designator on a null pointer of that type and fold it.
                let zero = self.sema.int_lit(0, ty.ptr_to(), loc)?;
                let mut place = self.sema.deref(zero, loc)?;
                let (first, _) = self.expect_ident()?;
                place = self.sema.member(place, &first, false, loc)?;
                loop {
                    if self.eat(Punct::Dot)? {
                        let (member, _) = self.expect_ident()?;
                        place = self.sema.member(place, &member, false, loc)?;
                    } else if self.at(Punct::LBracket) {
                        let iloc = self.bump()?.loc;
                        let index = self.parse_expr()?;
                        self.expect(Punct::RBracket)?;
                        place = self.sema.index(place, index, iloc)?;
                    } else {
                        break;
                    }
                }
                self.expect(Punct::RParen)?;
                let address = self.sema.addr_of(place, loc)?;
                let size_type = self.sema.size_type();
                let as_int = self.sema.cast(address, &size_type, loc)?;
                let value = match self.sema.const_int(&as_int) {
                    Ok(v) => v,
                    Err(_) => {
                        return err(loc, "__builtin_offsetof needs a constant member designator");
                    }
                };
                Ok(Some(self.sema.int_lit(value, size_type, loc)?))
            }
            "expect" | "expect_with_probability" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() < 2 {
                    return err(loc, "__builtin_expect takes two arguments");
                }
                let value = args.remove(0);
                let value = self.sema.cast(value, &Type::Long, loc)?;
                Ok(Some(self.after_evaluating(args, value, loc)?))
            }
            "complex" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() != 2 {
                    return err(loc, "__builtin_complex takes two arguments");
                }
                let im = args.swap_remove(1);
                let re = args.swap_remove(0);
                Ok(Some(self.sema.builtin_complex(re, im, loc)?))
            }
            "constant_p" => {
                let args = self.parse_builtin_args()?;
                let constant = args.len() == 1 && self.sema.constant_p(&args[0]);
                Ok(Some(self.sema.int_lit(
                    i64::from(constant),
                    Type::Int,
                    loc,
                )?))
            }
            "types_compatible_p" => {
                self.expect(Punct::LParen)?;
                let a = self.parse_type_name()?;
                self.expect(Punct::Comma)?;
                let b = self.parse_type_name()?;
                self.expect(Punct::RParen)?;
                // (GCC: top-level qualifiers are ignored.)
                let same = Sema::compatible(a.unqualified(), b.unqualified());
                Ok(Some(self.sema.int_lit(i64::from(same), Type::Int, loc)?))
            }
            "unreachable" | "trap" => {
                let args = self.parse_builtin_args()?;
                if !args.is_empty() {
                    return err(loc, format!("{name} takes no arguments"));
                }
                let op = if short == "trap" {
                    Intrinsic::Trap
                } else {
                    Intrinsic::Unreachable
                };
                Ok(Some(self.sema.intrinsic(op, None, Type::Void, loc)?))
            }
            "bswap16" | "bswap32" | "bswap64" | "clz" | "clzl" | "clzll" | "ctz" | "ctzl"
            | "ctzll" | "popcount" | "popcountl" | "popcountll" => {
                let (op, arg_ty, ret) = match short {
                    "bswap16" => (Intrinsic::Bswap, Type::UShort, Type::UShort),
                    "bswap32" => (Intrinsic::Bswap, uint.clone(), uint),
                    // `uint64_t`, which is `unsigned long` where that has 64 bits.
                    "bswap64" if self.sema.tcx.size_of(&ulong) == Some(8) => {
                        (Intrinsic::Bswap, ulong.clone(), ulong)
                    }
                    "bswap64" => (Intrinsic::Bswap, ullong.clone(), ullong),
                    "clz" => (Intrinsic::Clz, uint, Type::Int),
                    "clzl" => (Intrinsic::Clz, ulong, Type::Int),
                    "clzll" => (Intrinsic::Clz, ullong, Type::Int),
                    "ctz" => (Intrinsic::Ctz, uint, Type::Int),
                    "ctzl" => (Intrinsic::Ctz, ulong, Type::Int),
                    "ctzll" => (Intrinsic::Ctz, ullong, Type::Int),
                    "popcount" => (Intrinsic::Popcount, uint, Type::Int),
                    "popcountl" => (Intrinsic::Popcount, ulong, Type::Int),
                    _ => (Intrinsic::Popcount, ullong, Type::Int),
                };
                let mut args = self.parse_builtin_args()?;
                if args.len() != 1 {
                    return err(loc, format!("{name} takes one argument"));
                }
                let arg = args.swap_remove(0);
                Ok(Some(self.sema.intrinsic(
                    op,
                    Some((arg, arg_ty)),
                    ret,
                    loc,
                )?))
            }
            "huge_val" | "inf" | "huge_valf" | "inff" | "nan" | "nanf" | "nans" | "nansf"
            | "huge_vall" | "infl" | "nanl" | "nansl" => {
                self.parse_builtin_args()?;
                let single = matches!(short, "huge_valf" | "inff" | "nanf");
                let long = matches!(short, "huge_vall" | "infl" | "nanl");
                if matches!(short, "nans" | "nansf" | "nansl") {
                    return err(loc, format!("{name}: signalling NaNs are not supported"));
                }
                if long && self.sema.tcx.target.long_double_size().is_some() {
                    if !self.sema.tcx.target.long_double_is_x87() {
                        return err(
                            loc,
                            "computing with values of type 'long double' is not supported yet",
                        );
                    }
                    let value = if short == "nanl" {
                        Extended::NAN
                    } else {
                        Extended::INFINITY
                    };
                    return Ok(Some(self.sema.long_double_lit(value, loc)?));
                }
                let value = if short.starts_with("nan") {
                    f64::NAN
                } else {
                    f64::INFINITY
                };
                let ty = if single {
                    Type::Float
                } else if long {
                    Type::LongDouble64
                } else {
                    Type::Double
                };
                Ok(Some(self.sema.float_lit(value, ty, loc)?))
            }
            "prefetch" | "__clear_cache" => {
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.discard_all(args, loc)?))
            }
            "cpu_init" => {
                let args = self.parse_builtin_args()?;
                if !args.is_empty() {
                    return err(loc, format!("{name} takes no arguments"));
                }
                Ok(Some(self.sema.discard_all(args, loc)?))
            }
            "cpu_supports" | "cpu_is" => {
                self.expect(Punct::LParen)?;
                let Tok::Str(feature, ..) = self.cur.tok.clone() else {
                    return err(loc, format!("{name} takes a string literal"));
                };
                self.bump()?;
                self.expect(Punct::RParen)?;
                // No processor model is ever claimed.
                if short == "cpu_is" {
                    return Ok(Some(self.sema.int_lit(0, Type::Int, loc)?));
                }
                Ok(Some(self.sema.cpu_supports(&feature, loc)?))
            }
            "assume_aligned" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() != 2 && args.len() != 3 {
                    return err(loc, format!("{name} takes two or three arguments"));
                }
                let pointer = self.sema.rvalue(args.remove(0))?;
                if !pointer.ty.is_ptr() {
                    return err(
                        loc,
                        format!("the first operand of {name} must be a pointer"),
                    );
                }
                let pointer = self.sema.cast(pointer, &Type::Void.ptr_to(), loc)?;
                Ok(Some(self.after_evaluating(args, pointer, loc)?))
            }
            // The size of the object a pointer points into is never known here.
            "object_size" | "dynamic_object_size" => {
                let args = self.parse_builtin_args()?;
                if args.len() != 2 {
                    return err(loc, format!("{name} takes two arguments"));
                }
                let Ok(kind) = self.sema.const_int(&args[1]) else {
                    return err(
                        loc,
                        format!("the second operand of {name} must be a constant"),
                    );
                };
                let size_type = self.sema.size_type();
                let unknown = if kind & 2 != 0 { 0 } else { -1 };
                Ok(Some(self.sema.int_lit(unknown, size_type, loc)?))
            }
            // For the compiler's own headers: what this compiler cannot do, said when it is
            // compiled into code that is used.
            "bun_unsupported" => {
                self.expect(Punct::LParen)?;
                let mut message = Vec::new();
                while let Tok::Str(part, ..) = &self.cur.tok {
                    message.extend_from_slice(part);
                    self.bump()?;
                }
                self.expect(Punct::RParen)?;
                let message = format!("{} is not supported", crate::token::display_bytes(&message));
                Ok(Some(self.sema.unsupported_value(
                    Type::Int,
                    message,
                    loc,
                )?))
            }
            "assume" => {
                // The operand is not evaluated.
                self.parse_builtin_args()?;
                Ok(Some(self.sema.discard_all(Vec::new(), loc)?))
            }
            "unpredictable" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() != 1 {
                    return err(loc, format!("{name} takes one argument"));
                }
                let value = self.sema.rvalue(args.swap_remove(0))?;
                Ok(Some(self.sema.cast(value, &Type::Long, loc)?))
            }
            "choose_expr" => {
                self.expect(Punct::LParen)?;
                let chooser = self.parse_assign()?;
                let Ok(chooser) = self.sema.const_int(&chooser) else {
                    return err(
                        loc,
                        "the first operand of __builtin_choose_expr must be a constant",
                    );
                };
                self.expect(Punct::Comma)?;
                let first = self.parse_assign()?;
                self.expect(Punct::Comma)?;
                let second = self.parse_assign()?;
                self.expect(Punct::RParen)?;
                Ok(Some(if chooser != 0 { first } else { second }))
            }
            "frame_address" | "return_address" => {
                let args = self.parse_builtin_args()?;
                let level = match args.as_slice() {
                    [level] => self.sema.const_int(level).ok(),
                    _ => None,
                };
                let Some(level) = level.filter(|l| (0..=64).contains(l)) else {
                    return err(
                        loc,
                        format!("{name} takes one small constant: how many frames up"),
                    );
                };
                Ok(Some(self.sema.frame_builtin(
                    short == "return_address",
                    level as u32,
                    loc,
                )?))
            }
            "extract_return_addr" | "frob_return_addr" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() != 1 {
                    return err(loc, format!("{name} takes one argument"));
                }
                let address = self.sema.rvalue(args.swap_remove(0))?;
                Ok(Some(self.sema.cast(address, &Type::Void.ptr_to(), loc)?))
            }
            "add_overflow" | "sub_overflow" | "mul_overflow" => {
                let op = overflow_op(short);
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.overflow_builtin(op, None, name, args, loc)?))
            }
            "sadd_overflow" | "saddl_overflow" | "saddll_overflow" | "uadd_overflow"
            | "uaddl_overflow" | "uaddll_overflow" | "ssub_overflow" | "ssubl_overflow"
            | "ssubll_overflow" | "usub_overflow" | "usubl_overflow" | "usubll_overflow"
            | "smul_overflow" | "smull_overflow" | "smulll_overflow" | "umul_overflow"
            | "umull_overflow" | "umulll_overflow" => {
                let signed = short.starts_with('s');
                let width = short[4..].strip_suffix("_overflow").unwrap_or("");
                let ty = match (signed, width) {
                    (true, "") => Type::Int,
                    (true, "l") => Type::Long,
                    (true, _) => Type::LLong,
                    (false, "") => uint,
                    (false, "l") => ulong,
                    (false, _) => ullong,
                };
                let op = overflow_op(&short[1..]);
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.overflow_builtin(
                    op,
                    Some(&ty),
                    name,
                    args,
                    loc,
                )?))
            }
            "rotateleft8" | "rotateleft16" | "rotateleft32" | "rotateleft64" | "rotateright8"
            | "rotateright16" | "rotateright32" | "rotateright64" => {
                let left = short.starts_with("rotateleft");
                let bits = match short.trim_start_matches(|c: char| c.is_ascii_alphabetic()) {
                    "8" => 8,
                    "16" => 16,
                    "32" => 32,
                    _ => 64,
                };
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.rotate_builtin(left, bits, name, args, loc)?))
            }
            "isnan" | "isinf" | "isinf_sign" | "isfinite" | "isnormal" | "signbit" | "signbitf"
            | "signbitl" | "isnanf" | "isnanl" | "isinff" | "isinfl" | "finite" | "finitef"
            | "finitel" => {
                let which = match short {
                    "signbitf" | "signbitl" => "signbit",
                    "isnanf" | "isnanl" => "isnan",
                    "isinff" | "isinfl" => "isinf",
                    "finite" | "finitef" | "finitel" => "isfinite",
                    other => other,
                };
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.classify_builtin(which, name, args, loc)?))
            }
            "fpclassify" => {
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.fpclassify_builtin(name, args, loc)?))
            }
            "isgreater" | "isgreaterequal" | "isless" | "islessequal" | "islessgreater"
            | "isunordered" => {
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.compare_builtin(short, name, args, loc)?))
            }
            "fabsl" | "copysignl" if self.sema.tcx.target.long_double_is_x87() => {
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.sign_builtin_long_double(
                    sign_from(short),
                    name,
                    args,
                    loc,
                )?))
            }
            "fabsl" | "copysignl" if self.sema.tcx.target.long_double_size().is_none() => {
                let args = self.parse_builtin_args()?;
                let as_double =
                    self.sema
                        .sign_builtin(Precision::Double, sign_from(short), name, args, loc)?;
                Ok(Some(self.sema.convert(
                    as_double,
                    &Type::LongDouble64,
                    loc,
                )?))
            }
            "fabs" | "fabsf" | "copysign" | "copysignf" => {
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.sign_builtin(
                    if short.ends_with('f') {
                        Precision::Single
                    } else {
                        Precision::Double
                    },
                    sign_from(short),
                    name,
                    args,
                    loc,
                )?))
            }
            "clrsb" | "clrsbl" | "clrsbll" => {
                let ty = match short {
                    "clrsb" => Type::Int,
                    "clrsbl" => Type::Long,
                    _ => Type::LLong,
                };
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.clrsb_builtin(&ty, name, args, loc)?))
            }
            "bitreverse8" | "bitreverse16" | "bitreverse32" | "bitreverse64" => {
                let bits = match short {
                    "bitreverse8" => 8,
                    "bitreverse16" => 16,
                    "bitreverse32" => 32,
                    _ => 64,
                };
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.bitreverse_builtin(bits, name, args, loc)?))
            }
            "ffs" | "ffsl" | "ffsll" => {
                let ty = match short {
                    "ffs" => uint,
                    "ffsl" => ulong,
                    _ => ullong,
                };
                let args = self.parse_builtin_args()?;
                Ok(Some(self.sema.ffs_builtin(&ty, name, args, loc)?))
            }
            "parity" | "parityl" | "parityll" => {
                let ty = match short {
                    "parity" => uint,
                    "parityl" => ulong,
                    _ => ullong,
                };
                let mut args = self.parse_builtin_args()?;
                if args.len() != 1 {
                    return err(loc, format!("{name} takes one argument"));
                }
                let count = self.sema.intrinsic(
                    Intrinsic::Popcount,
                    Some((args.swap_remove(0), ty)),
                    Type::Int,
                    loc,
                )?;
                let one = self.sema.int_lit(1, Type::Int, loc)?;
                Ok(Some(self.sema.binary(BinOp::And, count, one, loc)?))
            }
            "va_start" => {
                self.expect(Punct::LParen)?;
                let ap = self.parse_assign()?;
                // The second operand names the last parameter; C23 lets it be omitted.
                if self.eat(Punct::Comma)? {
                    self.parse_assign()?;
                }
                self.expect(Punct::RParen)?;
                Ok(Some(self.sema.va_start(ap, loc)?))
            }
            "va_arg" => {
                self.expect(Punct::LParen)?;
                let ap = self.parse_assign()?;
                self.expect(Punct::Comma)?;
                let ty = self.parse_type_name()?;
                self.expect(Punct::RParen)?;
                Ok(Some(self.sema.va_arg(ap, ty, loc)?))
            }
            "va_end" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() != 1 {
                    return err(loc, "va_end takes one argument");
                }
                Ok(Some(self.sema.va_end(args.swap_remove(0), loc)?))
            }
            "va_copy" => {
                let mut args = self.parse_builtin_args()?;
                if args.len() != 2 {
                    return err(loc, "va_copy takes two arguments");
                }
                let src = args.swap_remove(1);
                let dst = args.swap_remove(0);
                Ok(Some(self.sema.va_copy(dst, src, loc)?))
            }
            _ => {
                // `__builtin_memcpy` and friends are the C library functions of the same name.
                let Some(fty) = library_prototype(short, self.sema.tcx.target) else {
                    return Ok(None);
                };
                let id = self.sema.declare_library_function(short, fty, loc)?;
                Ok(Some(self.sema.function_ref(id, loc)?))
            }
        }
    }

    /// `__atomic_*`, `__sync_*` and the two `__c11_atomic_*` builtins `<stdatomic.h>` uses.
    fn parse_atomic_builtin(&mut self, name: &str, loc: Loc) -> Res<Option<Expr>> {
        let arith = |op: &str| -> Option<RmwOp> {
            Some(match op {
                "add" => RmwOp::Arith(BinOp::Add),
                "sub" => RmwOp::Arith(BinOp::Sub),
                "and" => RmwOp::Arith(BinOp::And),
                "or" => RmwOp::Arith(BinOp::Or),
                "xor" => RmwOp::Arith(BinOp::Xor),
                "nand" => RmwOp::Nand,
                "min" => RmwOp::Min,
                "max" => RmwOp::Max,
                _ => return None,
            })
        };
        // (operation, evaluates to the new value, C11 pointer scaling)
        use crate::sema::simd::{PointerStep, Yields};
        let rmw: Option<(RmwOp, Yields, PointerStep)> =
            if let Some(op) = name.strip_prefix("__atomic_fetch_") {
                arith(op).map(|op| (op, Yields::Old, PointerStep::Bytes))
            } else if let Some(op) = name.strip_prefix("__c11_atomic_fetch_") {
                arith(op).map(|op| {
                    let step = if matches!(op, RmwOp::Arith(BinOp::Add | BinOp::Sub)) {
                        PointerStep::Elements
                    } else {
                        PointerStep::Bytes
                    };
                    (op, Yields::Old, step)
                })
            } else if let Some(op) = name
                .strip_prefix("__atomic_")
                .and_then(|n| n.strip_suffix("_fetch"))
            {
                arith(op).map(|op| (op, Yields::New, PointerStep::Bytes))
            } else if name == "__atomic_exchange_n" || name == "__c11_atomic_exchange" {
                Some((RmwOp::Exchange, Yields::Old, PointerStep::Bytes))
            } else {
                None
            };
        let sync_rmw: Option<(RmwOp, Yields)> =
            if let Some(op) = name.strip_prefix("__sync_fetch_and_") {
                arith(op).map(|op| (op, Yields::Old))
            } else if let Some(op) = name
                .strip_prefix("__sync_")
                .and_then(|n| n.strip_suffix("_and_fetch"))
            {
                arith(op).map(|op| (op, Yields::New))
            } else {
                None
            };
        let known = rmw.is_some()
            || sync_rmw.is_some()
            || matches!(
                name,
                "__atomic_load_n"
                    | "__atomic_store_n"
                    | "__atomic_compare_exchange_n"
                    | "__atomic_load"
                    | "__atomic_store"
                    | "__atomic_exchange"
                    | "__atomic_compare_exchange"
                    | "__atomic_test_and_set"
                    | "__atomic_clear"
                    | "__atomic_thread_fence"
                    | "__atomic_signal_fence"
                    | "__atomic_always_lock_free"
                    | "__atomic_is_lock_free"
                    | "__sync_bool_compare_and_swap"
                    | "__sync_val_compare_and_swap"
                    | "__sync_lock_test_and_set"
                    | "__sync_lock_release"
                    | "__sync_synchronize"
                    | "__c11_atomic_load"
                    | "__c11_atomic_store"
                    | "__c11_atomic_init"
                    | "__c11_atomic_compare_exchange_strong"
                    | "__c11_atomic_compare_exchange_weak"
                    | "__c11_atomic_thread_fence"
                    | "__c11_atomic_signal_fence"
                    | "__c11_atomic_is_lock_free"
            );
        if !known || !self.at(Punct::LParen) {
            return Ok(None);
        }
        let mut args = self.parse_builtin_args()?;
        // Clang's spellings of the same operations, on pointers to `_Atomic` objects.
        let name = match name {
            "__c11_atomic_load" => "__atomic_load_n",
            "__c11_atomic_store" => "__atomic_store_n",
            "__c11_atomic_init" => {
                args.push(self.sema.int_lit(0, Type::Int, loc)?);
                "__atomic_store_n"
            }
            "__c11_atomic_compare_exchange_strong" | "__c11_atomic_compare_exchange_weak" => {
                if args.len() == 5 {
                    let weak = i64::from(name.ends_with("weak"));
                    args.insert(3, self.sema.int_lit(weak, Type::Int, loc)?);
                }
                "__atomic_compare_exchange_n"
            }
            "__c11_atomic_thread_fence" => "__atomic_thread_fence",
            "__c11_atomic_signal_fence" => "__atomic_signal_fence",
            "__c11_atomic_is_lock_free" => {
                args.push(self.sema.int_lit(0, Type::Void.ptr_to(), loc)?);
                "__atomic_is_lock_free"
            }
            other => other,
        };
        // A 16-byte object: there is no such atomic operation in BIR (and a lock would not be
        // one). Headers define helpers like that which most units never call, so this is an
        // error only where such a call is compiled.
        let wide_object = args.first().and_then(|a| {
            let object = a.ty.pointee()?.unatomic();
            (object.is_scalar() && self.sema.tcx.size_of(object) == Some(16))
                .then(|| object.clone())
        });
        if let Some(object) = wide_object {
            let ty = if has_suffix(name, "compare_exchange_n")
                || has_suffix(name, "compare_exchange")
                || has_suffix(name, "bool_compare_and_swap")
                || has_suffix(name, "test_and_set")
            {
                Type::Bool
            } else if matches!(
                name,
                "__atomic_store_n"
                    | "__atomic_store"
                    | "__atomic_load"
                    | "__atomic_exchange"
                    | "__atomic_clear"
                    | "__sync_lock_release"
            ) {
                Type::Void
            } else {
                object.clone()
            };
            let message = format!(
                "{name} on an object of type '{}' is not supported: there are no 16-byte atomic operations",
                self.sema.tcx.display(&object)
            );
            return Ok(Some(self.sema.mk(
                ExprKind::Unsupported(Rc::from(message)),
                ty,
                loc,
            )?));
        }
        let sema = &self.sema;
        if let Some((op, yields, step)) = rmw {
            return Ok(Some(sema.atomic_rmw(name, op, yields, step, args, loc)?));
        }
        if let Some((op, yields)) = sync_rmw {
            return Ok(Some(sema.sync_rmw(name, op, yields, args, loc)?));
        }
        Ok(Some(match name {
            "__atomic_load_n" => sema.atomic_load_n(name, args, loc)?,
            "__atomic_store_n" => sema.atomic_store_n(name, args, loc)?,
            "__atomic_compare_exchange_n" => sema.atomic_compare_exchange_n(name, args, loc)?,
            "__atomic_test_and_set" => sema.atomic_flag_op(name, true, args, loc)?,
            "__atomic_clear" => sema.atomic_flag_op(name, false, args, loc)?,
            "__atomic_thread_fence" => sema.atomic_fence(name, true, args, loc)?,
            "__atomic_signal_fence" => sema.atomic_fence(name, false, args, loc)?,
            "__atomic_always_lock_free" | "__atomic_is_lock_free" => {
                sema.atomic_lock_free(name, args, loc)?
            }
            "__sync_bool_compare_and_swap" => sema.sync_compare_and_swap(name, false, args, loc)?,
            "__sync_val_compare_and_swap" => sema.sync_compare_and_swap(name, true, args, loc)?,
            "__sync_lock_test_and_set" => sema.sync_lock_test_and_set(name, args, loc)?,
            "__sync_lock_release" => sema.sync_lock_release(name, args, loc)?,
            "__sync_synchronize" => {
                let order = sema.int_lit(5, Type::Int, loc)?;
                sema.atomic_fence(name, true, vec![order], loc)?
            }
            _ => sema.atomic_generic(name, args, loc)?,
        }))
    }

    /// The vector builtins of GCC and Clang, and the few x86 ones the intrinsic headers need.
    fn parse_vector_builtin(&mut self, name: &str, short: &str, loc: Loc) -> Res<Option<Expr>> {
        use crate::bir::Lane;
        if short == "convertvector" {
            self.expect(Punct::LParen)?;
            let v = self.parse_assign()?;
            self.expect(Punct::Comma)?;
            let ty = self.parse_type_name()?;
            self.expect(Punct::RParen)?;
            return Ok(Some(self.sema.convertvector(v, &ty, loc)?));
        }
        let elementwise = match short {
            "elementwise_abs" => Some(VecBuiltin::Abs),
            "elementwise_min" => Some(VecBuiltin::Min),
            "elementwise_max" => Some(VecBuiltin::Max),
            "elementwise_sqrt" => Some(VecBuiltin::Sqrt),
            _ => None,
        };
        let reduce = match short {
            "reduce_add" => Some(ReduceOp::Add),
            "reduce_mul" => Some(ReduceOp::Mul),
            "reduce_min" => Some(ReduceOp::Min),
            "reduce_max" => Some(ReduceOp::Max),
            "reduce_and" => Some(ReduceOp::And),
            "reduce_or" => Some(ReduceOp::Or),
            "reduce_xor" => Some(ReduceOp::Xor),
            _ => None,
        };
        let x86 = self.sema.tcx.target.arch == crate::types::Arch::X86_64;
        let movemask = match short {
            "ia32_pmovmskb128" if x86 => Some(Lane::I8x16),
            "ia32_movmskps" if x86 => Some(Lane::F32x4),
            "ia32_movmskpd" if x86 => Some(Lane::F64x2),
            _ => None,
        };
        let long_long = || Type::Vector(Rc::new(Type::LLong), 2);
        // The BIR VConvertKind and the result type.
        let convert: Option<(u8, Type)> = match short {
            _ if !x86 => None,
            "ia32_cvtdq2pd" => Some((4, Type::Vector(Rc::new(Type::Double), 2))),
            "ia32_cvttpd2dq" => Some((6, Type::Vector(Rc::new(Type::Int), 4))),
            "ia32_cvtps2pd" => Some((8, Type::Vector(Rc::new(Type::Double), 2))),
            "ia32_cvtpd2ps" => Some((9, Type::Vector(Rc::new(Type::Float), 4))),
            "ia32_pmovsxbw128" => Some((10, Type::Vector(Rc::new(Type::Short), 8))),
            "ia32_pmovzxbw128" => Some((11, Type::Vector(Rc::new(Type::Short), 8))),
            "ia32_pmovsxwd128" => Some((14, Type::Vector(Rc::new(Type::Int), 4))),
            "ia32_pmovzxwd128" => Some((15, Type::Vector(Rc::new(Type::Int), 4))),
            "ia32_pmovsxdq128" => Some((18, long_long())),
            "ia32_pmovzxdq128" => Some((19, long_long())),
            _ => None,
        };
        let is_test_zero = x86 && short == "ia32_ptestz128";
        let vector = |elem: Type, count: u32| Type::Vector(Rc::new(elem), count);
        // Whole-vector operations: the builtin, the shape its operands must have, and the
        // result type when it differs from the first operand's.
        let lane_op: Option<(VecBuiltin, Lane, Option<Type>)> = match short {
            "ia32_paddsb128" if x86 => {
                Some((VecBuiltin::AddSat { signed: true }, Lane::I8x16, None))
            }
            "ia32_paddsw128" if x86 => {
                Some((VecBuiltin::AddSat { signed: true }, Lane::I16x8, None))
            }
            "ia32_paddusb128" if x86 => {
                Some((VecBuiltin::AddSat { signed: false }, Lane::I8x16, None))
            }
            "ia32_paddusw128" if x86 => {
                Some((VecBuiltin::AddSat { signed: false }, Lane::I16x8, None))
            }
            "ia32_psubsb128" if x86 => {
                Some((VecBuiltin::SubSat { signed: true }, Lane::I8x16, None))
            }
            "ia32_psubsw128" if x86 => {
                Some((VecBuiltin::SubSat { signed: true }, Lane::I16x8, None))
            }
            "ia32_psubusb128" if x86 => {
                Some((VecBuiltin::SubSat { signed: false }, Lane::I8x16, None))
            }
            "ia32_psubusw128" if x86 => {
                Some((VecBuiltin::SubSat { signed: false }, Lane::I16x8, None))
            }
            "ia32_pavgb128" if x86 => Some((VecBuiltin::AverageUnsigned, Lane::I8x16, None)),
            "ia32_pavgw128" if x86 => Some((VecBuiltin::AverageUnsigned, Lane::I16x8, None)),
            "ia32_packsswb128" if x86 => Some((
                VecBuiltin::Narrow { signed: true },
                Lane::I16x8,
                Some(vector(Type::Char, 16)),
            )),
            "ia32_packuswb128" if x86 => Some((
                VecBuiltin::Narrow { signed: false },
                Lane::I16x8,
                Some(vector(Type::Char, 16)),
            )),
            "ia32_packssdw128" if x86 => Some((
                VecBuiltin::Narrow { signed: true },
                Lane::I32x4,
                Some(vector(Type::Short, 8)),
            )),
            "ia32_packusdw128" if x86 => Some((
                VecBuiltin::Narrow { signed: false },
                Lane::I32x4,
                Some(vector(Type::Short, 8)),
            )),
            "ia32_pmaddwd128" if x86 => Some((
                VecBuiltin::DotProduct,
                Lane::I16x8,
                Some(vector(Type::Int, 4)),
            )),
            "ia32_pmulhw128" if x86 => {
                Some((VecBuiltin::MulHigh16 { signed: true }, Lane::I16x8, None))
            }
            "ia32_pmulhuw128" if x86 => {
                Some((VecBuiltin::MulHigh16 { signed: false }, Lane::I16x8, None))
            }
            // Private to the compiler's own <arm_neon.h> and <tmmintrin.h>.
            "bir_swizzle" => Some((VecBuiltin::Swizzle, Lane::I8x16, None)),
            "bir_average_u8" => Some((VecBuiltin::AverageUnsigned, Lane::I8x16, None)),
            "bir_average_u16" => Some((VecBuiltin::AverageUnsigned, Lane::I16x8, None)),
            _ => None,
        };
        // `__builtin_bir_extmul_{low,high}_{s,u}{8,16,32}`: widening multiplies.
        let ext_mul: Option<(VecBuiltin, Lane, Option<Type>)> =
            short.strip_prefix("bir_extmul_").and_then(|rest| {
                let (high, rest) = match rest.strip_prefix("high_") {
                    Some(rest) => (true, rest),
                    None => (false, rest.strip_prefix("low_")?),
                };
                let (signed, lane, to) = match rest {
                    "s8" => (true, Lane::I8x16, vector(Type::Short, 8)),
                    "u8" => (false, Lane::I8x16, vector(Type::UShort, 8)),
                    "s16" => (true, Lane::I16x8, vector(Type::Int, 4)),
                    "u16" => (false, Lane::I16x8, vector(Type::UInt, 4)),
                    "s32" => (true, Lane::I32x4, vector(Type::LLong, 2)),
                    "u32" => (false, Lane::I32x4, vector(Type::ULLong, 2)),
                    _ => return None,
                };
                Some((VecBuiltin::ExtMul { signed, high }, lane, Some(to)))
            });
        let lane_op = lane_op.or(ext_mul);
        let saturating = match short {
            "elementwise_add_sat" => Some(true),
            "elementwise_sub_sat" => Some(false),
            _ => None,
        };
        let known = lane_op.is_some()
            || saturating.is_some()
            || elementwise.is_some()
            || reduce.is_some()
            || movemask.is_some()
            || convert.is_some()
            || is_test_zero
            || matches!(short, "shufflevector" | "shuffle");
        if !known {
            return Ok(None);
        }
        let args = self.parse_builtin_args()?;
        let sema = &self.sema;
        Ok(Some(if let Some((op, lane, to)) = lane_op {
            sema.lane_builtin(op, lane, to, name, args, loc)?
        } else if let Some(add) = saturating {
            sema.elementwise_saturating(add, name, args, loc)?
        } else if let Some(op) = elementwise {
            sema.elementwise(op, name, args, loc)?
        } else if let Some(op) = reduce {
            sema.reduce(op, name, args, loc)?
        } else if let Some(lane) = movemask {
            sema.movemask(lane, name, args, loc)?
        } else if let Some((kind, ty)) = convert {
            sema.convert_kind(kind, ty, name, args, loc)?
        } else if is_test_zero {
            sema.test_zero(name, args, loc)?
        } else if short == "shufflevector" {
            sema.shufflevector(args, loc)?
        } else {
            sema.gnu_shuffle(args, loc)?
        }))
    }

    fn parse_builtin_args(&mut self) -> Res<Vec<Expr>> {
        self.expect(Punct::LParen)?;
        let mut args = Vec::new();
        if !self.at(Punct::RParen) {
            loop {
                args.push(self.parse_assign()?);
                if !self.eat(Punct::Comma)? {
                    break;
                }
            }
        }
        self.expect(Punct::RParen)?;
        Ok(args)
    }
}

/// Marks (in `Function::inlining`, above the bits BIR knows) a function whose definition is
/// `extern inline __attribute__((gnu_inline))`: never the external definition.
const INLINE_ONLY_DEFINITION: u8 = 0x80;

/// Attributes that can be dropped without changing what the program does.
/// The attributes `parse_attribute_list` gives a meaning to.
const IMPLEMENTED_ATTRIBUTES: &[&str] = &[
    "aligned",
    "packed",
    "weak",
    "gnu_inline",
    "always_inline",
    "noinline",
    "cleanup",
    "mode",
    "alias",
    "weakref",
    "constructor",
    "destructor",
    "vector_size",
    "ext_vector_type",
    "transparent_union",
    "ms_struct",
    "gcc_struct",
];

/// What `__has_attribute(name)` says: whether the attribute is implemented, or is one of those
/// that say something about the code without changing what it means.
pub(crate) fn has_attribute(name: &[u8]) -> bool {
    let name = name
        .strip_prefix(b"__")
        .and_then(|n| n.strip_suffix(b"__"))
        .unwrap_or(name);
    IMPLEMENTED_ATTRIBUTES
        .iter()
        .chain(IGNORED_ATTRIBUTES)
        .any(|known| known.as_bytes() == name)
}

const IGNORED_ATTRIBUTES: &[&str] = &[
    // `__declspec`s: where a symbol comes from is the loader's business, and the rest describe
    // C++ classes, code placement, or what the optimizer and the analyzers may assume.
    "dllimport",
    "dllexport",
    "noalias",
    "allocator",
    "nothrow",
    "novtable",
    "uuid",
    "property",
    "safebuffers",
    "spectre",
    "code_seg",
    "allocate",
    "empty_bases",
    "guard",
    "intrin_type",
    "appdomain",
    "process",
    "jitintrinsic",
    "no_sanitize_address",
    "no_init_all",
    "hybrid_patchable",
    "access",
    "alloc_align",
    "alloc_size",
    "always_inline",
    "artificial",
    "assume_aligned",
    "availability",
    "cdecl",
    "cold",
    "common",
    "const",
    "copy",
    "counted_by",
    "deprecated",
    "designated_init",
    "diagnose_if",
    "disable_tail_calls",
    "enum_extensibility",
    "error",
    "externally_visible",
    "fallthrough",
    "fd_arg",
    "flag_enum",
    "flatten",
    "format",
    "format_arg",
    "hot",
    "internal_linkage",
    "leaf",
    "malloc",
    "may_alias",
    "maybe_unused",
    "minsize",
    "no_address_safety_analysis",
    "no_builtin",
    "no_icf",
    "no_instrument_function",
    "no_profile_instrument_function",
    "no_reorder",
    "no_sanitize",
    "no_sanitize_address",
    "no_sanitize_memory",
    "no_sanitize_thread",
    "no_sanitize_undefined",
    "no_split_stack",
    "no_stack_limit",
    "no_stack_protector",
    "noclone",
    "nocommon",
    "nodebug",
    "nodiscard",
    "noescape",
    "noinline",
    "noipa",
    "nonnull",
    "nonstring",
    "noplt",
    "noreturn",
    "nothrow",
    "null_terminated_string_arg",
    "objc_root_class",
    "optimize",
    "optnone",
    "patchable_function_entry",
    "pure",
    "retain",
    "returns_nonnull",
    "returns_twice",
    "section",
    "sentinel",
    "simd",
    "stack_protect",
    "sysv_abi",
    "ms_abi",
    "stdcall",
    "fastcall",
    "thiscall",
    "regparm",
    "target",
    // One version of the function instead of one per listed target.
    "target_clones",
    "tainted_args",
    "tls_model",
    "unavailable",
    "uninitialized",
    "unused",
    "used",
    "visibility",
    "warn_if_not_aligned",
    "warn_unused_result",
    "warning",
    "zero_call_used_regs",
    "__const",
    "const__",
    // C23's and C++'s own, which headers written for both use.
    "likely",
    "unlikely",
    "unsequenced",
    "reproducible",
    "_Noreturn",
    "carries_dependency",
    "no_unique_address",
];

/// `fabs…` or `copysign…`, without the `__builtin_`.
fn sign_from(short: &str) -> SignFrom {
    if short.starts_with("copysign") {
        SignFrom::SecondArgument
    } else {
        SignFrom::Nowhere
    }
}

/// `++` or `--`.
fn step_of(p: Punct) -> crate::sema::Step {
    if p == Punct::PlusPlus {
        crate::sema::Step::Up
    } else {
        crate::sema::Step::Down
    }
}

fn has_suffix(name: &str, suffix: &str) -> bool {
    name.ends_with(suffix)
}

fn overflow_op(name: &str) -> crate::sema::builtin::OverflowOp {
    use crate::sema::builtin::OverflowOp;
    if name.starts_with("add") {
        OverflowOp::Add
    } else if name.starts_with("sub") {
        OverflowOp::Sub
    } else {
        OverflowOp::Mul
    }
}

/// Prototypes of the C library functions that have `__builtin_` spellings.
pub(crate) fn is_library_builtin(name: &str, target: Target) -> bool {
    library_prototype(name, target).is_some()
}

fn library_prototype(name: &str, target: Target) -> Option<Rc<FuncType>> {
    let size = if target.long_size() == 8 {
        Type::ULong
    } else {
        Type::ULLong
    };
    let void_ptr = Type::Void.ptr_to();
    let char_ptr = Type::Char.ptr_to();
    let (ret, params): (Type, Vec<Type>) = match name {
        "memcpy" | "memmove" => (void_ptr.clone(), vec![void_ptr.clone(), void_ptr, size]),
        "memset" => (void_ptr.clone(), vec![void_ptr, Type::Int, size]),
        "memcmp" => (Type::Int, vec![void_ptr.clone(), void_ptr, size]),
        "memchr" => (void_ptr.clone(), vec![void_ptr, Type::Int, size]),
        "strlen" => (size, vec![char_ptr]),
        "strcmp" => (Type::Int, vec![char_ptr.clone(), char_ptr]),
        "strncmp" => (Type::Int, vec![char_ptr.clone(), char_ptr, size]),
        "strcpy" | "strcat" => (char_ptr.clone(), vec![char_ptr.clone(), char_ptr]),
        "strncpy" | "strncat" => (char_ptr.clone(), vec![char_ptr.clone(), char_ptr, size]),
        "strchr" | "strrchr" => (char_ptr.clone(), vec![char_ptr, Type::Int]),
        "abs" => (Type::Int, vec![Type::Int]),
        "labs" => (Type::Long, vec![Type::Long]),
        "llabs" => (Type::LLong, vec![Type::LLong]),
        "sqrt" | "floor" | "ceil" | "trunc" | "round" | "rint" | "nearbyint" | "sin" | "cos"
        | "tan" | "exp" | "exp2" | "log" | "log2" | "log10" | "cbrt" | "asin" | "acos" | "atan"
        | "sinh" | "cosh" | "tanh" | "logb" => (Type::Double, vec![Type::Double]),
        "sqrtl" | "floorl" | "ceill" | "truncl" | "roundl" | "rintl" | "nearbyintl" | "sinl"
        | "cosl" | "tanl" | "expl" | "exp2l" | "logl" | "log2l" | "log10l" | "cbrtl" | "logbl"
        | "fabsl" => {
            let long_double = target.long_double_type();
            (long_double.clone(), vec![long_double])
        }
        "powl" | "fmodl" | "fmaxl" | "fminl" | "atan2l" | "hypotl" | "copysignl" => {
            let long_double = target.long_double_type();
            (long_double.clone(), vec![long_double.clone(), long_double])
        }
        "ldexpl" | "scalbnl" => {
            let long_double = target.long_double_type();
            (long_double.clone(), vec![long_double, Type::Int])
        }
        "sqrtf" | "floorf" | "ceilf" | "truncf" | "roundf" | "rintf" | "nearbyintf" | "sinf"
        | "cosf" | "tanf" | "expf" | "exp2f" | "logf" | "log2f" | "log10f" | "cbrtf" | "logbf" => {
            (Type::Float, vec![Type::Float])
        }
        "pow" | "fmod" | "fmax" | "fmin" | "atan2" | "hypot" | "fdim" | "remainder" => {
            (Type::Double, vec![Type::Double, Type::Double])
        }
        "powf" | "fmodf" | "fmaxf" | "fminf" | "atan2f" | "hypotf" | "fdimf" => {
            (Type::Float, vec![Type::Float, Type::Float])
        }
        "fma" => (Type::Double, vec![Type::Double, Type::Double, Type::Double]),
        "fmaf" => (Type::Float, vec![Type::Float, Type::Float, Type::Float]),
        "ldexp" | "scalbn" => (Type::Double, vec![Type::Double, Type::Int]),
        "ldexpf" | "scalbnf" => (Type::Float, vec![Type::Float, Type::Int]),
        "lround" | "lrint" => (Type::Long, vec![Type::Double]),
        "lroundf" | "lrintf" => (Type::Long, vec![Type::Float]),
        "llround" | "llrint" => (Type::LLong, vec![Type::Double]),
        "ilogb" => (Type::Int, vec![Type::Double]),
        "abort" => (Type::Void, vec![]),
        "exit" => (Type::Void, vec![Type::Int]),
        "malloc" => (void_ptr, vec![size]),
        "calloc" => (void_ptr, vec![size.clone(), size]),
        "realloc" => (void_ptr.clone(), vec![void_ptr, size]),
        "free" => (Type::Void, vec![void_ptr]),
        "bcmp" => (Type::Int, vec![void_ptr.clone(), void_ptr, size]),
        "bzero" => (Type::Void, vec![void_ptr, size]),
        "mempcpy" => (void_ptr.clone(), vec![void_ptr.clone(), void_ptr, size]),
        "stpcpy" => (char_ptr.clone(), vec![char_ptr.clone(), char_ptr]),
        "strstr" | "strpbrk" => (char_ptr.clone(), vec![char_ptr.clone(), char_ptr]),
        "strspn" | "strcspn" => (size, vec![char_ptr.clone(), char_ptr]),
        "strnlen" => (size.clone(), vec![char_ptr, size]),
        "strdup" => (char_ptr.clone(), vec![char_ptr]),
        "puts" => (Type::Int, vec![char_ptr]),
        "putchar" => (Type::Int, vec![Type::Int]),
        _ => return None,
    };
    Some(Rc::new(FuncType {
        ret,
        params,
        variadic: false,
        unprototyped: false,
    }))
}
