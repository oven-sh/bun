//! Static detection of CommonJS export names for ESM `import { x } from "./x.cjs"`.
//!
//! Node.js decides which named imports a CommonJS module offers by lexing its
//! source (cjs-module-lexer), so a name that is only assigned conditionally
//! (`if (dev) exports.debug = ...`) or that was assigned and then replaced
//! (`exports.a = 1; module.exports = { b }`) still links and imports as
//! `undefined`. Bun builds the list from the own properties of `module.exports`
//! after evaluation (`populateESMExports` in JSCommonJSModule.cpp). This pass
//! collects the same patterns the lexer documents while the runtime transpiler
//! visits a CommonJS file, and the module loader adds any names that are missing
//! from the evaluated `module.exports` on top of the runtime ones:
//!
//! - `exports.x = ...`, `exports["x"] = ...`, `module.exports.x = ...`
//! - `module.exports = { x, "y": ..., ...require("./z") }`
//! - `Object.defineProperty(exports, "x", { value | get })`
//! - re-exports: `module.exports = require("./z")`, `__exportStar(require("./z"), exports)`,
//!   `__export(require("./z"))`. Like the lexer, a later `module.exports = ...`
//!   assignment discards re-exports collected before it.
//!
//! Matching is purely lexical (`exports` / `module` by name, whatever they are
//! bound to, in any scope, reachable or not), exactly like the lexer. The result
//! travels as one string so it can be stored in the runtime transpiler cache and
//! handed to C++ without a separate ownership protocol; see [`serialize`] for the
//! format.

use std::io::Write as _;

use bun_alloc::AstAlloc;
use bun_collections::StringArrayHashMap;
use bun_collections::array_hash_map::StringContext;
use bun_core::strings;

use crate::p::P;
use bun_ast::{self as js_ast, E, Expr, ExprData, G, StoreStr};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

pub(crate) struct CommonJSStaticExports<'a> {
    /// Insertion-ordered set; TypeScript output assigns every name twice
    /// (`exports.x = void 0; ... exports.x = x;`).
    names: StringArrayHashMap<(), StringContext, AstAlloc>,
    reexports: BumpVec<'a, &'a [u8]>,
}

// Entry kind prefixes in the serialized form; JSCommonJSModule.cpp reads them.
const SERIALIZED_EXPORT_NAME: u8 = b'e';
const SERIALIZED_REEXPORT: u8 = b'r';

impl<'a> CommonJSStaticExports<'a> {
    pub(crate) fn new_in(arena: &'a bun_alloc::Arena) -> Self {
        Self {
            names: StringArrayHashMap::default(),
            reexports: BumpVec::new_in(arena),
        }
    }

    fn add_name(&mut self, name: &[u8]) {
        // `default` is always the exports object (or `exports.default` under an
        // `__esModule` marker) and `__esModule` itself is never a named export;
        // both are decided from the evaluated object in `populateESMExports`.
        if name.is_empty() || name == b"default" || name == b"__esModule" {
            return;
        }
        if !self.names.contains(name) {
            let _ = self.names.put(name, ());
        }
    }

    fn add_reexport(&mut self, specifier: &'a [u8]) {
        if !specifier.is_empty() && !self.reexports.contains(&specifier) {
            self.reexports.push(specifier);
        }
    }

    /// Serializes into `arena` as a sequence of `<kind><utf16 length>:<text>`
    /// entries, e.g. `e6:alwayse9:debugOnlyr10:./cond.cjs`. The length counts
    /// UTF-16 code units because the consumer (`JSCommonJSModule`) walks it as a
    /// `WTF::String`. Returns the empty string when nothing was detected.
    pub(crate) fn serialize(&self, arena: &'a bun_alloc::Arena) -> StoreStr {
        if self.names.is_empty() && self.reexports.is_empty() {
            return StoreStr::EMPTY;
        }

        let mut out: Vec<u8> = Vec::new();
        let mut append = |kind: u8, text: &[u8]| {
            // Names come from identifiers and string literals the lexer already
            // decoded, so this only rejects a literal that was invalid UTF-8 in
            // the source; such a name could not be imported anyway.
            if core::str::from_utf8(text).is_err() {
                return;
            }
            let utf16_len = strings::element_length_utf8_into_utf16(text);
            out.push(kind);
            // Writing to a `Vec<u8>` cannot fail.
            let _ = write!(out, "{utf16_len}:");
            out.extend_from_slice(text);
        };
        for name in self.names.keys() {
            append(SERIALIZED_EXPORT_NAME, name);
        }
        for specifier in self.reexports.iter() {
            append(SERIALIZED_REEXPORT, specifier);
        }
        StoreStr::new(arena.alloc_slice_copy(&out))
    }
}

/// Which side of `module.exports` an expression refers to, textually.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ExportsObject {
    /// `exports`
    Exports,
    /// `module.exports` / `module["exports"]`
    ModuleExports,
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline]
    fn collects_commonjs_static_exports(&self) -> bool {
        self.options.features.commonjs_at_runtime
    }

    fn identifier_name(&self, expr: &Expr) -> Option<&'a [u8]> {
        match expr.data {
            ExprData::EIdentifier(ident) => Some(self.load_name_from_ref(ident.ref_)),
            _ => None,
        }
    }

    fn string_literal(&self, expr: &Expr) -> Option<&'a [u8]> {
        match expr.data {
            ExprData::EString(mut str) => Some(str.slice(self.arena)),
            _ => None,
        }
    }

    fn exports_object(&self, expr: &Expr) -> Option<ExportsObject> {
        let is_module = |target: &Expr| self.identifier_name(target) == Some(b"module");
        match expr.data {
            ExprData::EIdentifier(_) => {
                (self.identifier_name(expr) == Some(b"exports")).then_some(ExportsObject::Exports)
            }
            ExprData::EDot(dot) => {
                (dot.name == b"exports" && is_module(&dot.target)).then_some(ExportsObject::ModuleExports)
            }
            ExprData::EIndex(index) => (self.string_literal(&index.index) == Some(b"exports")
                && is_module(&index.target))
            .then_some(ExportsObject::ModuleExports),
            _ => None,
        }
    }

    /// `exports.x` / `exports["x"]` / `module.exports.x` / `module.exports["x"]` => `x`
    fn exports_member_name(&self, expr: &Expr) -> Option<&'a [u8]> {
        match expr.data {
            ExprData::EDot(dot) => self.exports_object(&dot.target).map(|_| dot.name.slice()),
            ExprData::EIndex(index) => {
                self.exports_object(&index.target)?;
                self.string_literal(&index.index)
            }
            _ => None,
        }
    }

    /// `require("x")` => `x`
    fn require_specifier(&self, expr: &Expr) -> Option<&'a [u8]> {
        let ExprData::ECall(call) = expr.data else {
            return None;
        };
        if self.identifier_name(&call.target) != Some(b"require") {
            return None;
        }
        match call.args.as_slice() {
            [specifier] => self.string_literal(specifier),
            _ => None,
        }
    }

    /// Non-computed key of an object literal property, for `{ x }`, `{ x: ... }`,
    /// `{ "x": ... }`, `{ x() {} }`, `{ get x() {} }`.
    fn property_key_name(&self, property: &G::Property) -> Option<&'a [u8]> {
        if property.flags.contains(js_ast::flags::Property::IsComputed) {
            return None;
        }
        match property.kind {
            G::PropertyKind::Normal | G::PropertyKind::Get | G::PropertyKind::Set => {
                self.string_literal(&property.key?)
            }
            _ => None,
        }
    }

    /// Runs before the operands of `left = right` are visited.
    pub(crate) fn record_commonjs_static_export_assignment(&mut self, left: &Expr, right: &Expr) {
        if !self.collects_commonjs_static_exports() {
            return;
        }
        if self.exports_object(left) == Some(ExportsObject::ModuleExports) {
            self.record_commonjs_static_module_exports_value(right);
        } else if let Some(name) = self.exports_member_name(left) {
            self.commonjs_static_exports.add_name(name);
        }
    }

    /// `module.exports = value` (also TypeScript's `export = value`).
    pub(crate) fn record_commonjs_static_module_exports_value(&mut self, value: &Expr) {
        if !self.collects_commonjs_static_exports() {
            return;
        }
        self.commonjs_static_exports.reexports.clear();

        if let Some(specifier) = self.require_specifier(value) {
            self.commonjs_static_exports.add_reexport(specifier);
            return;
        }

        let ExprData::EObject(object) = value.data else {
            return;
        };
        for property in object.properties.iter() {
            if property.kind == G::PropertyKind::Spread {
                if let Some(specifier) = property.value.as_ref().and_then(|v| self.require_specifier(v)) {
                    self.commonjs_static_exports.add_reexport(specifier);
                }
            } else if let Some(name) = self.property_key_name(property) {
                self.commonjs_static_exports.add_name(name);
            }
        }
    }

    /// Runs before the callee and arguments of a call are visited.
    pub(crate) fn record_commonjs_static_export_call(&mut self, call: &E::Call) {
        if !self.collects_commonjs_static_exports() {
            return;
        }
        match call.target.data {
            // Object.defineProperty(exports, "x", { value: ... }) or { get() {...} }
            ExprData::EDot(dot) => {
                if dot.name == b"defineProperty" {
                    if self.identifier_name(&dot.target) == Some(b"Object") {
                        self.record_commonjs_static_define_property(call.args.as_slice());
                    }
                } else if dot.name == b"__exportStar" || dot.name == b"__export" {
                    self.record_commonjs_static_export_star(call.args.as_slice());
                }
            }
            // __exportStar(require("./x"), exports) (TypeScript), __export(require("./x")) (older TypeScript)
            ExprData::EIdentifier(_) => {
                if matches!(self.identifier_name(&call.target), Some(b"__exportStar" | b"__export")) {
                    self.record_commonjs_static_export_star(call.args.as_slice());
                }
            }
            _ => {}
        }
    }

    fn record_commonjs_static_define_property(&mut self, args: &[Expr]) {
        let [target, name, descriptor, ..] = args else {
            return;
        };
        if self.exports_object(target).is_none() {
            return;
        }
        let ExprData::EObject(descriptor) = descriptor.data else {
            return;
        };
        let defines_value_or_getter = descriptor.properties.iter().any(|property| {
            matches!(self.property_key_name(property), Some(b"value" | b"get"))
        });
        if !defines_value_or_getter {
            return;
        }
        if let Some(name) = self.string_literal(name) {
            self.commonjs_static_exports.add_name(name);
        }
    }

    fn record_commonjs_static_export_star(&mut self, args: &[Expr]) {
        if let Some(specifier) = args.first().and_then(|arg| self.require_specifier(arg)) {
            self.commonjs_static_exports.add_reexport(specifier);
        }
    }
}
