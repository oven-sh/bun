//! `--target=bun_builtins`: the syntax of `src/js`. Every rewrite happens on a node the visit pass
//! has not reached yet, so what it produces is visited like source text.

use bstr::BStr;
use bun_ast::op::Level;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{
    E, Expr, ExprData as Data, ExprNodeList, LexerLog as _, Loc, OpCode as Op, Range, S, Stmt,
    Target, flags,
};
use bun_builtin_syntax::{Literal, Macro, MacroError, Manifest};
use bun_collections::VecExt as _;

use crate::Error;
use crate::lexer::{self, Lexer};
use crate::p::P;

impl<'a> Lexer<'a> {
    /// The name of the identifier `raw`, which starts with `$`.
    pub(crate) fn builtin_name(&mut self, raw: &'a [u8]) -> Result<&'a [u8], lexer::Error> {
        let name = &raw[1..];
        if !name
            .first()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        {
            return Ok(raw);
        }
        if !Manifest::installed().is_some_and(|manifest| manifest.is_known_name(name)) {
            self.add_range_error(
                self.range(),
                format_args!("\"{}\" is not a builtin name", BStr::new(raw)),
            )?;
        }
        let name: &'a [u8] = self
            .arena
            .alloc_slice_copy(&[Target::PRIVATE_NAME_PREFIX, name].concat());
        Ok(name)
    }
}

fn literal_of<'s>(argument: &Expr) -> Literal<'s> {
    match argument.data {
        Data::EString(string) if string.is_utf8() && string.next.is_none() => {
            Literal::String(string.data.slice())
        }
        _ => Literal::Other,
    }
}

fn is_named_export(stmt: &Stmt) -> bool {
    match stmt.data {
        StmtData::SLocal(local) => local.is_export,
        StmtData::SFunction(function) => function.func.flags.contains(flags::Function::IsExport),
        StmtData::SClass(class) => class.is_export,
        StmtData::SEnum(declaration) => declaration.is_export,
        StmtData::SNamespace(namespace) => namespace.is_export,
        StmtData::SExportClause(_) | StmtData::SExportFrom(_) | StmtData::SExportStar(_) => true,
        _ => false,
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    fn unresolved_identifier(&mut self, name: &'a [u8], loc: Loc) -> Expr {
        let ref_ = self.store_name_in_ref(name);
        Expr::init_identifier(ref_, loc)
    }

    fn private_identifier(&mut self, name: &[u8], loc: Loc) -> Expr {
        let name: &'a [u8] = self
            .arena
            .alloc_slice_copy(&[Target::PRIVATE_NAME_PREFIX, name].concat());
        self.unresolved_identifier(name, loc)
    }

    fn private_call(&mut self, name: &[u8], arguments: &[Expr], loc: Loc) -> Expr {
        let target = self.private_identifier(name, loc);
        self.new_expr(
            E::Call {
                target,
                args: ExprNodeList::from_slice(arguments),
                ..Default::default()
            },
            loc,
        )
    }

    fn number(&mut self, value: u32, loc: Loc) -> Expr {
        self.new_expr(E::Number::new(f64::from(value)), loc)
    }

    /// `value` in a debug build. It is visited either way: its scopes are in the list of scopes.
    fn in_development(&mut self, manifest: &Manifest, value: Expr, loc: Loc) -> Expr {
        let test = self.new_expr(
            E::Boolean {
                value: manifest.is_development(),
            },
            loc,
        );
        let zero = self.number(0, loc);
        let no = self.new_expr(
            E::Unary {
                op: Op::UnVoid,
                value: zero,
                flags: E::UnaryFlags::default(),
            },
            loc,
        );
        self.new_expr(
            E::If {
                test,
                yes: value,
                no,
            },
            loc,
        )
    }

    /// `export default value`, after the `default`.
    pub(crate) fn parse_builtin_module_value(&mut self, loc: Loc) -> Result<Stmt, Error> {
        let value = self.parse_expr(Level::Comma)?;
        self.lexer.expect_or_insert_semicolon()?;
        Ok(self.s(S::Return { value: Some(value) }, loc))
    }

    /// Call between the parse pass and the visit pass. A module with named exports keeps them, and
    /// the linker returns them as an object.
    pub(crate) fn finish_builtin_module(&mut self, stmts: &[Stmt]) {
        let value = stmts
            .iter()
            .position(|stmt| matches!(stmt.data, StmtData::SReturn(_)));
        let named_export = stmts.iter().find(|stmt| is_named_export(stmt));
        if value.is_some() && let Some(named_export) = named_export {
            self.log().add_error_fmt(
                Some(self.source),
                named_export.loc,
                format_args!(
                    "Using `export default` AND named exports together in builtin modules is unsupported. See src/js/README.md"
                ),
            );
        }
        if value.is_none() && named_export.is_none() {
            self.log().add_error_fmt(
                Some(self.source),
                Loc { start: 0 },
                format_args!(
                    "Internal modules must have at least one ESM export statement. See src/js/README.md"
                ),
            );
        }

        let Some(value) = value else {
            return;
        };
        if let Some(stmt) = stmts.get(value + 1) {
            self.log().add_error_fmt(
                Some(self.source),
                stmt.loc,
                format_args!("`export default` must be the last statement of a builtin module"),
            );
        }
        // Only `export type` and `export interface` can have set it.
        self.esm_export_keyword = Range::NONE;
    }

    /// The source text of the first argument of `call`, which starts at `loc`.
    fn first_argument_text(&self, call: &E::Call, loc: Loc) -> Option<&'a [u8]> {
        let source: &'a [u8] = &self.source.contents;
        let start = usize::try_from(loc.start).ok()?;
        let open = start + source.get(start..)?.iter().position(|&byte| byte == b'(')?;
        let end = match call.args.slice() {
            [] => return None,
            [_] => usize::try_from(call.close_paren_loc.start).ok()?,
            [_, second, ..] => source
                .get(..usize::try_from(second.loc.start).ok()?)?
                .iter()
                .rposition(|&byte| byte == b',')?,
        };
        let text = source.get(open + 1..end)?.trim_ascii();
        Some(match text.strip_suffix(b",") {
            Some(text) => text.trim_ascii_end(),
            None => text,
        })
    }

    fn expand_builtin_require(&mut self, e: &mut Expr, call: &E::Call) -> bool {
        let Some(manifest) = Manifest::installed() else {
            return false;
        };
        let specifier = match call.args.slice() {
            [argument] => literal_of(argument),
            _ => Literal::Other,
        };
        let Literal::String(specifier) = specifier else {
            self.log().add_error_fmt(
                Some(self.source),
                e.loc,
                format_args!("Require with dynamic specifier not supported here."),
            );
            return false;
        };
        let importer: &[u8] = match manifest.module_for_path(self.source.path.text) {
            Some(module) => &module.path,
            None => &[],
        };
        let Some(id) = manifest.resolve(specifier, importer) else {
            self.log().add_error_fmt(
                Some(self.source),
                e.loc,
                format_args!(
                    "Could not resolve \"{}\". Only files in \"src/js\" besides \"src/js/builtins\" can be imported here. Note that the \"node:\" or \"bun:\" prefix is required here.",
                    BStr::new(specifier)
                ),
            );
            return false;
        };

        let loc = e.loc;
        let id = self.number(id, loc);
        let registry = self.private_identifier(b"internalModuleRegistry", loc);
        let left = self.private_call(b"getInternalField", &[registry, id], loc);
        let right = self.private_call(b"createInternalModuleById", &[id], loc);
        *e = self.new_expr(
            E::Binary {
                op: Op::BinLogicalOr,
                left,
                right,
            },
            loc,
        );
        true
    }

    /// Returns whether `e`, a call that has not been visited, was replaced by what it stands for.
    pub(crate) fn expand_builtin_call(&mut self, e: &mut Expr) -> bool {
        let Some(mut call) = e.data.e_call() else {
            return false;
        };
        let Data::EIdentifier(target) = call.target.data else {
            return false;
        };
        if call.optional_chain.is_some() {
            return false;
        }
        let name = self.load_name_from_ref(target.ref_);
        if name == b"require" {
            return self.expand_builtin_require(e, &call);
        }
        let Some(name) = name.strip_prefix(Target::PRIVATE_NAME_PREFIX) else {
            return false;
        };
        let Some(manifest) = Manifest::installed() else {
            return false;
        };

        let loc = e.loc;
        let target_loc = call.target.loc;
        let literals: Vec<Literal<'_>> = call.args.slice().iter().map(literal_of).collect();
        let expansion = match manifest.macro_for_call(name, &literals) {
            Ok(Some(expansion)) => expansion,
            Ok(None) => return false,
            Err(MacroError::ArgumentsNotLiteral) => {
                self.log().add_error_fmt(
                    Some(self.source),
                    loc,
                    format_args!("Call is not known at bundle-time: \"${}\"", BStr::new(name)),
                );
                return false;
            }
            Err(MacroError::UnknownNativeBinding) => {
                self.log().add_error_fmt(
                    Some(self.source),
                    loc,
                    format_args!(
                        "This \"${}\" call is not in the builtins manifest",
                        BStr::new(name)
                    ),
                );
                return false;
            }
        };

        match expansion {
            Macro::Prepend { callee, constant } => {
                let mut arguments = ExprNodeList::init_capacity(call.args.len() + 1);
                arguments.push(self.number(constant, loc));
                arguments.extend_from_slice(call.args.slice());
                call.target = self.private_identifier(callee, target_loc);
                call.args = arguments;
            }
            Macro::NativeBinding(id) => {
                call.target = self.private_identifier(b"lazy", target_loc);
                call.args = ExprNodeList::init_one(self.number(id, loc));
            }
            Macro::DebugLog => {
                call.target = self.unresolved_identifier(b"$debug_log", target_loc);
                *e = self.in_development(manifest, *e, loc);
            }
            Macro::Assert => {
                let Some(text) = self.first_argument_text(&call, loc) else {
                    self.log().add_error_fmt(
                        Some(self.source),
                        loc,
                        format_args!("\"$assert\" takes a condition"),
                    );
                    return false;
                };
                let text = self.new_expr(E::String::init_re_encode_utf8(text, self.arena), loc);
                let mut arguments = ExprNodeList::init_capacity(call.args.len() + 1);
                arguments.push(call.args.slice()[0]);
                arguments.push(text);
                arguments.extend_from_slice(&call.args.slice()[1..]);
                call.target = self.unresolved_identifier(b"$assert", target_loc);
                call.args = arguments;
                *e = self.in_development(manifest, *e, loc);
            }
            Macro::PromiseStatus(status) => {
                call.target = self.private_identifier(b"peekPromiseStatus", target_loc);
                let right = self.number(status, loc);
                *e = self.new_expr(
                    E::Binary {
                        op: Op::BinStrictEq,
                        left: *e,
                        right,
                    },
                    loc,
                );
            }
            Macro::BundleError => {
                if !self.is_control_flow_dead {
                    let message: &[u8] = match literals.first() {
                        Some(Literal::String(message)) => *message,
                        _ => b"$bundleError",
                    };
                    self.log().add_error_fmt(
                        Some(self.source),
                        loc,
                        format_args!("{}", BStr::new(message)),
                    );
                }
                return false;
            }
        }
        true
    }

    fn call_in_place_of_new(&mut self, new: &mut E::New, callee: &[u8], loc: Loc) -> Expr {
        let target = self.private_identifier(callee, new.target.loc);
        self.new_expr(
            E::Call {
                target,
                args: bun_alloc::AstAlloc::take(&mut new.args),
                close_paren_loc: new.close_parens_loc,
                ..Default::default()
            },
            loc,
        )
    }

    fn constructor_name(&self, new: &E::New) -> &'a [u8] {
        match new.target.data {
            Data::EIdentifier(target) => self.load_name_from_ref(target.ref_),
            _ => b"",
        }
    }

    /// `new TypeError(..)` is `$makeTypeError(..)`.
    pub(crate) fn expand_builtin_new(&mut self, e: &mut Expr) -> bool {
        let Some(mut new) = e.data.e_new() else {
            return false;
        };
        if self.constructor_name(&new) != b"TypeError" {
            return false;
        }
        *e = self.call_in_place_of_new(&mut new, b"makeTypeError", e.loc);
        true
    }

    /// `throw new TypeError(..)` is `$throwTypeError(..)`, and the same for `RangeError`.
    pub(crate) fn builtin_throw_call(&mut self, value: &Expr) -> Option<Expr> {
        let mut new = value.data.e_new()?;
        let callee: &[u8] = match self.constructor_name(&new) {
            b"TypeError" => b"throwTypeError",
            b"RangeError" => b"throwRangeError",
            _ => return None,
        };
        Some(self.call_in_place_of_new(&mut new, callee, value.loc))
    }

    /// A class extends the public global, not its private copy.
    pub(crate) fn keep_public_heritage(&mut self, extends: &mut Expr) {
        let Data::EIdentifier(identifier) = extends.data else {
            return;
        };
        let name = self.load_name_from_ref(identifier.ref_);
        if Manifest::installed().is_some_and(|manifest| manifest.is_hardened_global(name)) {
            let name: &'a [u8] = self
                .arena
                .alloc_slice_copy(&[Target::PUBLIC_NAME_PREFIX, name].concat());
            *extends = self.unresolved_identifier(name, extends.loc);
        }
    }
}
