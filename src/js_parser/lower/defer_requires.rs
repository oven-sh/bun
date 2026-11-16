//! `Features::defers_requires`. A linter's configuration loads whole plugins to read a few lists out of them, and most of
//! what the plugins `require` is only used once a rule runs, if ever.
//!
//! ```js
//! const a = require("a");                  const a = $Bun_defer(require, "a");
//! const { b } = require("b");       =>     const b = $Bun_defer(require, "b", $Bun_it => $Bun_it.b, ["b"]);
//! exports.f = () => a(b);                  exports.f = () => a()(b());
//! exports.c = { d: require("d") };         exports.c = $Bun_lazy({ d: $Bun_defer(require, "d") }, "d");
//! ```
//!
//! Both functions are in src/runtime/defer_require.js. `$Bun_defer` decides at run time whether the module is loaded right
//! away after all. A variable that is read while the module loads stays as it is.
//!
//! Whether it matters when a module is loaded can't be told from the module that requires it, so this is only for the
//! packages of [`is_in_known_package`].

#![cfg_attr(mordant, allow(generic_body_not_generic))]

use bun_alloc::Arena;
use bun_ast::binding::Data as BindingData;
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::symbol::Kind;
use bun_ast::{self as js_ast, B, E, Expr, G, ImportKind, Loc, Ref, S, Stmt, StoreRef};
use bun_collections::VecExt;
use bun_core::strings;

use crate::p::P;

#[derive(Default)]
pub(crate) struct WhileLoading {
    /// How many functions are around what is visited, not counting those that are called where they are written.
    pub(crate) functions_around: u32,
    /// The function that the call which is being visited calls.
    pub(crate) called: Option<Loc>,
    /// By symbol
    reads: Vec<u32>,
    /// Import records
    pub(crate) requires: Vec<u32>,
    /// Those that are deferred, sorted, each with its letter for [`LOADS`]
    deferred: Vec<(u32, u8)>,
}

impl WhileLoading {
    pub(crate) fn note_read(&mut self, symbol: Ref) {
        let at = symbol.inner_index() as usize;
        if self.reads.len() <= at {
            self.reads.resize(at + 1, 0);
        }
        self.reads[at] += 1;
    }

    /// Returns what to take off `functions_around` after the function at `loc`.
    pub(crate) fn enter_function(&mut self, loc: Loc) -> u32 {
        let counts = u32::from(self.called.take() != Some(loc));
        self.functions_around += counts;
        counts
    }
}

/// Where the function is that `call` calls, and its body, if that is written in place and runs to its end.
pub(crate) fn function_called_in_place(call: &E::Call) -> Option<(Loc, js_ast::StoreSlice<Stmt>)> {
    use js_ast::flags::Function::{IsAsync, IsGenerator};
    let target = match call.target.data {
        ExprData::EDot(dot) if matches!(&*dot.name, b"call" | b"apply") => dot.target,
        _ => call.target,
    };
    match target.data {
        // One with a name can call itself.
        ExprData::EFunction(it)
            if it.func.name.is_none()
                && !it.func.flags.contains(IsAsync)
                && !it.func.flags.contains(IsGenerator) =>
        {
            Some((target.loc, it.func.body.stmts))
        }
        ExprData::EArrow(it) if !it.is_async => Some((target.loc, it.body.stmts)),
        _ => None,
    }
}

/// While what these require loads, it changes no other module, as the modules of `postcss` and `@babel/types` do, which
/// register themselves. Sorted.
const KNOWN_PACKAGES: &[&[u8]] = &[
    b"@babel/eslint-parser",
    b"@babel/helper-compilation-targets",
    b"@eslint-community/eslint-plugin-eslint-comments",
    b"@eslint-community/eslint-utils",
    b"@eslint/config-array",
    b"@eslint/eslintrc",
    b"@eslint/js",
    b"@eslint/plugin-kit",
    b"@next/eslint-plugin-next",
    b"ajv",
    b"array-includes",
    b"array.prototype.findlast",
    b"array.prototype.findlastindex",
    b"array.prototype.flat",
    b"array.prototype.flatmap",
    b"array.prototype.tosorted",
    b"browserslist",
    b"call-bind-apply-helpers",
    b"caniuse-lite",
    b"core-js-compat",
    b"es-abstract",
    b"es-iterator-helpers",
    b"eslint",
    b"eslint-config-next",
    b"eslint-import-resolver-node",
    b"eslint-module-utils",
    b"eslint-plugin-compat",
    b"eslint-plugin-es-x",
    b"eslint-plugin-flowtype",
    b"eslint-plugin-import",
    b"eslint-plugin-jest",
    b"eslint-plugin-jsx-a11y",
    b"eslint-plugin-promise",
    b"eslint-plugin-react",
    b"eslint-plugin-react-hooks",
    b"eslint-plugin-sonarjs",
    b"eslint-plugin-unicorn",
    b"eslint-plugin-vue",
    b"espree",
    b"get-intrinsic",
    b"jsx-ast-utils",
    b"object.entries",
    b"object.fromentries",
    b"object.values",
    b"parse-json",
    b"postcss-selector-parser",
    b"prop-types",
    b"resolve",
    b"semver",
    b"tsconfig-paths",
    b"typescript-eslint",
    b"vue-eslint-parser",
];

pub fn is_in_known_package(path: &[u8]) -> bool {
    bun_paths::package_of(path).is_some_and(|it| {
        it.starts_with(b"@typescript-eslint/") || KNOWN_PACKAGES.binary_search(&&it[..]).is_ok()
    })
}

/// What compilers wrap a `require` in that has been an `import`.
fn is_interop_helper(name: &[u8]) -> bool {
    matches!(
        name,
        b"__importDefault"
            | b"__importStar"
            | b"__toESM"
            | b"_interopRequireDefault"
            | b"_interopRequireWildcard"
            | b"_interop_require_default"
            | b"_interop_require_wildcard"
            | b"_interopDefault"
            | b"_interopDefaultCompat"
            | b"_interopDefaultLegacy"
            | b"_interopNamespace"
            | b"_interopNamespaceCompat"
            | b"_interopNamespaceDefault"
            | b"getDefaultExportFromCjs"
    )
}

/// To call what these export makes a value and changes nothing, but for [`has_effect`].
fn only_makes_values(specifier: &[u8]) -> bool {
    matches!(specifier, b"debug" | b"zod" | b"zod/v3" | b"zod/v4")
}

fn has_effect(method: &[u8]) -> bool {
    matches!(
        method,
        b"add"
            | b"clear"
            | b"config"
            | b"disable"
            | b"enable"
            | b"load"
            | b"log"
            | b"parse"
            | b"parseAsync"
            | b"register"
            | b"remove"
            | b"save"
            | b"setErrorMap"
    )
}

#[derive(Copy, Clone, PartialEq)]
enum Origin {
    Unknown,
    Module,
    /// See [`only_makes_values`]
    MakerOfValues,
}

#[derive(Copy, Clone)]
enum Place {
    Declaration(StoreRef<S::Local>, usize),
    Property(StoreRef<E::Object>, usize),
    /// `exports.name = ..`
    Export(StoreRef<E::Binary>, StoreRef<S::SExpr>),
}

struct Candidate {
    place: Place,
    /// The `require` in the initializer. Without one it is made of other candidates.
    record: Option<u32>,
    loads: bool,
    bindings: Vec<Ref>,
    /// What the initializer reads
    reads: Vec<Ref>,
    is_deferred: bool,
}

struct Found {
    candidates: Vec<Candidate>,
    /// Each with what it reads
    unused_values: Vec<(StoreRef<S::SExpr>, Vec<Ref>)>,
    /// By symbol
    origins: Vec<Origin>,
    /// By symbol
    is_declared_again: Vec<bool>,
    /// By symbol: to read a property reads it
    is_handed_on: Vec<bool>,
    /// By symbol: `requireName()` of Rollup, `require_name()` of esbuild
    loads_bundled_module: Vec<bool>,
    /// It has statements left over that only make a schema, and schemas of `enum`s, which are assigned to.
    has_react_compiler: bool,
    /// The number of statements of the longest body, and how many functions that are called in place it is in
    longest_body: usize,
    depth: u32,
}

#[derive(Default)]
struct Initializer {
    record: Option<u32>,
    reads: Vec<Ref>,
    makes_value: bool,
    loads_bundled_module: bool,
}

#[derive(Copy, Clone)]
struct Names {
    defer: Ref,
    lazy: Ref,
    it: Ref,
}

/// The last line of a module, or of the function around it: this, a digit for how many functions most of the module is in,
/// and, each after a tab, what it imports (`i`) or requires (`r`) while it loads, what it requires once a property is read
/// (`p`), which is often soon, and what it requires once a function is called (`f`).
pub const LOADS: &[u8] = b"//#bun-loads ";

/// More is deferred in the module at `path`.
pub fn has_react_compiler(path: &[u8]) -> bool {
    bun_paths::package_of(path).is_some_and(|it| it == b"eslint-plugin-react-hooks")
}

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    /// Returns how many functions that are called in place most of the module is in.
    pub(crate) fn defer_requires(&mut self, parts: &[js_ast::Part]) -> u32 {
        let mut found = Found {
            candidates: Vec::new(),
            unused_values: Vec::new(),
            origins: vec![Origin::Unknown; self.symbols.len()],
            is_declared_again: vec![false; self.symbols.len()],
            is_handed_on: vec![false; self.symbols.len()],
            loads_bundled_module: self.loaders_of_bundled_modules(),
            has_react_compiler: has_react_compiler(self.source.path.text),
            longest_body: parts.iter().map(|it| it.stmts.len()).sum(),
            depth: 0,
        };
        if found.has_react_compiler {
            for (symbol, origin) in self.symbols.iter().zip(&mut found.origins) {
                if matches!(
                    &*symbol.original_name,
                    b"parseEnvironmentConfig" | b"withLoc"
                ) {
                    *origin = Origin::MakerOfValues;
                }
            }
        }
        for symbol in self.symbols.iter().filter(|it| it.has_link()) {
            let target = symbol.link.get().inner_index() as usize;
            if let Some(slot) = found.is_declared_again.get_mut(target) {
                *slot = true;
            }
        }
        for part in parts {
            self.find_candidates(part.stmts.slice(), true, 0, &mut found);
        }
        if self.module_scope().contains_direct_eval {
            return found.depth;
        }

        let mut reads = core::mem::take(&mut self.while_loading.reads);
        reads.resize(self.symbols.len(), 0);
        for (mut unused, its_reads) in found.unused_values.drain(..) {
            unused.value = self.new_expr(E::Undefined {}, unused.value.loc);
            for read in its_reads {
                let count = &mut reads[read.inner_index() as usize];
                *count = count.saturating_sub(1);
            }
        }
        for read in found.candidates.iter().flat_map(|it| &it.reads) {
            let count = &mut reads[read.inner_index() as usize];
            *count = count.saturating_sub(1);
        }
        let records = self.import_records.items();
        let specifier = |record: u32| records[record as usize].path.text;
        // `const { method } = require("a")` may precede `require("a").method = ..`.
        let mut loaded_now: Vec<&[u8]> = Vec::new();
        found
            .candidates
            .iter_mut()
            .for_each(|it| it.is_deferred = true);
        loop {
            // An initializer only reads earlier candidates.
            for candidate in found
                .candidates
                .iter_mut()
                .rev()
                .filter(|it| it.is_deferred)
            {
                let at = |it: &Ref| it.inner_index() as usize;
                let bindings = &candidate.bindings;
                let is_read_now = bindings.iter().any(|it| reads[at(it)] > 0);
                let is_used =
                    (bindings.iter()).any(|it| self.symbols[at(it)].use_count_estimate > 0);
                // It is required for what loading it does.
                let is_for_effect = !is_used && candidate.loads && !bindings.is_empty();
                let is_loaded_now = (candidate.record)
                    .is_some_and(|it| loaded_now.binary_search(&specifier(it)).is_ok());
                candidate.is_deferred = !is_read_now && !is_for_effect && !is_loaded_now;
                if !candidate.is_deferred {
                    candidate.reads.iter().for_each(|it| reads[at(it)] += 1);
                }
            }
            let deferred = found.candidates.iter().filter(|it| it.is_deferred);
            let mut deferred: Vec<u32> = deferred.filter_map(|it| it.record).collect();
            deferred.sort_unstable();
            let before = loaded_now.len();
            loaded_now = (self.while_loading.requires.iter())
                .filter(|it| deferred.binary_search(it).is_err())
                .map(|it| specifier(*it))
                .collect();
            if loaded_now.len() == before {
                break;
            }
            loaded_now.sort_unstable();
        }

        // A property has nothing to wait for if the module is loaded by then.
        let deferred = found.candidates.iter().filter(|it| it.is_deferred);
        let mut is_deferred = vec![false; self.symbols.len()];
        for binding in deferred.flat_map(|it| &it.bindings) {
            is_deferred[binding.inner_index() as usize] = true;
        }
        let waits = |it: &Candidate| {
            it.loads
                || !it.bindings.is_empty()
                || (it.reads.iter()).any(|it| is_deferred[it.inner_index() as usize])
        };
        found.candidates.retain(|it| it.is_deferred && waits(it));
        if found.candidates.is_empty() {
            return found.depth;
        }
        self.has_deferred_requires = true;
        let names = Names {
            defer: self.new_symbol(Kind::Unbound, b"$Bun_defer"),
            lazy: self.new_symbol(Kind::Unbound, b"$Bun_lazy"),
            it: self.new_symbol(Kind::Other, b"$Bun_it"),
        };
        // Backwards, so that the indices of the other declarations of a statement hold.
        for candidate in found.candidates.iter().rev() {
            self.rewrite(candidate, names);
            let handed_on = &mut found.is_handed_on;
            let is_for_property = !matches!(candidate.place, Place::Declaration(..))
                || (candidate.bindings.iter()).any(|it| handed_on[it.inner_index() as usize]);
            for it in candidate.reads.iter().filter(|_| is_for_property) {
                handed_on[it.inner_index() as usize] = true;
            }
            let kind = if is_for_property { b'p' } else { b'f' };
            (self.while_loading.deferred).extend(candidate.record.map(|it| (it, kind)));
        }
        self.while_loading.deferred.sort_unstable();
        found.depth
    }

    /// `is_body`: each of the statements runs, in turn.
    fn find_candidates(&self, stmts: &[Stmt], is_body: bool, depth: u32, found: &mut Found) {
        if !self.stack_check.is_safe_to_recurse() {
            return;
        }
        for stmt in stmts {
            match stmt.data {
                StmtData::SLocal(local)
                    if is_body && !local.is_export && !local.kind.is_using() =>
                {
                    for decl in 0..local.decls.len() {
                        match self.candidate(local, decl, found) {
                            Some(candidate) => found.candidates.push(candidate),
                            None => {
                                if let Some(value) = local.decls.slice()[decl].value {
                                    self.find_properties(value, None, found);
                                }
                            }
                        }
                    }
                }
                StmtData::SBlock(block) => {
                    self.find_candidates(block.stmts.slice(), false, depth, found)
                }
                StmtData::SIf(it) => {
                    self.find_candidates(&[it.yes], false, depth, found);
                    self.find_candidates(it.no.as_slice(), false, depth, found);
                }
                StmtData::SExpr(it) => {
                    let mut made = Initializer::default();
                    if found.has_react_compiler
                        && self.is_mere_value(it.value, found, &mut made)
                        && made.makes_value
                    {
                        found.unused_values.push((it, made.reads));
                        continue;
                    }
                    if is_body {
                        self.find_properties(it.value, Some(it), found);
                    }
                    if let Some(module) = self.module_exported_from(it.value) {
                        found.is_handed_on[module.inner_index() as usize] = true;
                    }
                    let value = match it.value.data {
                        ExprData::EUnary(unary) => unary.value,
                        _ => it.value,
                    };
                    if let ExprData::ECall(call) = value.data
                        && let Some((_, body)) = function_called_in_place(&call)
                    {
                        if body.len() > found.longest_body {
                            (found.longest_body, found.depth) = (body.len(), depth + 1);
                        }
                        self.find_candidates(body.slice(), true, depth + 1, found);
                    }
                }
                _ => {}
            }
        }
    }

    /// `statement`: the one that is nothing but `value`
    fn find_properties(
        &self,
        value: Expr,
        statement: Option<StoreRef<S::SExpr>>,
        found: &mut Found,
    ) {
        if !self.stack_check.is_safe_to_recurse() {
            return;
        }
        let property = |place: Place, value: Expr, found: &mut Found| {
            let mut initializer = Initializer::default();
            if self.origin_of_chain(value, found, &mut initializer) != Some(Origin::Module) {
                return self.find_properties(value, None, found);
            }
            found.candidates.push(Candidate {
                place,
                record: initializer.record,
                loads: initializer.record.is_some() || initializer.loads_bundled_module,
                bindings: Vec::new(),
                reads: initializer.reads,
                is_deferred: false,
            });
        };
        match value.data {
            ExprData::EBinary(it) if it.op == js_ast::OpCode::BinAssign => {
                match (it.left.data, statement) {
                    (ExprData::EDot(left), Some(statement)) if self.is_exports(left.target) => {
                        property(Place::Export(it, statement), it.right, found)
                    }
                    _ => self.find_properties(it.right, None, found),
                }
            }
            ExprData::EObject(object) => {
                let mut keys = Vec::with_capacity(object.properties.len());
                for it in object.properties.slice() {
                    match it.key.map(|it| it.data) {
                        Some(ExprData::EString(key))
                            if key.is_utf8()
                                && !it.flags.contains(js_ast::flags::Property::IsComputed) =>
                        {
                            keys.push(key.slice8().to_vec())
                        }
                        // It could replace another property.
                        _ => return,
                    }
                }
                keys.push(b"__proto__".to_vec());
                keys.sort_unstable();
                if keys.iter().zip(keys.iter().skip(1)).any(|(a, b)| a == b) {
                    return;
                }
                for (at, it) in object.properties.slice().iter().enumerate() {
                    if let (G::PropertyKind::Normal, Some(value)) = (it.kind, it.value) {
                        property(Place::Property(object, at), value, found);
                    }
                }
            }
            _ => {}
        }
    }

    /// `Object.defineProperty(exports, "name", { get: function () { return module.name; } })`
    fn module_exported_from(&self, value: Expr) -> Option<Ref> {
        let ExprData::ECall(call) = value.data else {
            return None;
        };
        let [object, _, descriptor] = call.args.slice() else {
            return None;
        };
        let (true, ExprData::EObject(descriptor)) = (self.is_exports(*object), descriptor.data)
        else {
            return None;
        };
        let values = descriptor.properties.slice().iter();
        values.filter_map(|it| it.value).find_map(|it| {
            let ExprData::EFunction(getter) = it.data else {
                return None;
            };
            let StmtData::SReturn(returned) = getter.func.body.stmts.slice().first()?.data else {
                return None;
            };
            let ExprData::EDot(member) = returned.value?.data else {
                return None;
            };
            match member.target.data {
                ExprData::EIdentifier(it) => Some(it.ref_),
                _ => None,
            }
        })
    }

    fn is_exports(&self, value: Expr) -> bool {
        match value.data {
            ExprData::EIdentifier(it) => it.ref_ == self.exports_ref,
            ExprData::EDot(it) => {
                *it.name == *b"exports"
                    && matches!(it.target.data, ExprData::EIdentifier(it) if it.ref_ == self.module_ref)
            }
            _ => false,
        }
    }

    fn candidate(
        &self,
        local: StoreRef<S::Local>,
        decl: usize,
        found: &mut Found,
    ) -> Option<Candidate> {
        let G::Decl { binding, value } = local.decls.slice().get(decl)?;
        let mut initializer = Initializer::default();
        let origin = self.origin_of((*value)?, found, &mut initializer)?;
        let mut bindings = Vec::new();
        match binding.data {
            BindingData::BIdentifier(id) => bindings.push(id.r#ref),
            BindingData::BObject(object) => {
                for property in object.properties.slice() {
                    let (ExprData::EString(key), BindingData::BIdentifier(id)) =
                        (property.key.data, property.value.data)
                    else {
                        return None;
                    };
                    if property.default_value.is_some()
                        || !key.is_utf8()
                        || (property.flags).contains(js_ast::flags::Property::IsComputed)
                        || (property.flags).contains(js_ast::flags::Property::IsSpread)
                    {
                        return None;
                    }
                    bindings.push(id.r#ref);
                }
            }
            _ => return None,
        }
        let of_wrapper = [
            self.exports_ref,
            self.require_ref,
            self.module_ref,
            self.filename_ref,
            self.dirname_ref,
        ];
        let is_constant = |it: &Ref| {
            let symbol = &self.symbols[it.inner_index() as usize];
            matches!(symbol.kind, Kind::Hoisted | Kind::Constant | Kind::Other)
                && !symbol.has_link()
                && !symbol.has_been_assigned_to()
                && !found.is_declared_again[it.inner_index() as usize]
                && !of_wrapper.contains(it)
        };
        if bindings.is_empty() || !bindings.iter().all(is_constant) {
            return None;
        }
        for it in &bindings {
            found.origins[it.inner_index() as usize] = origin;
        }
        Some(Candidate {
            place: Place::Declaration(local, decl),
            record: initializer.record,
            loads: initializer.record.is_some() || initializer.loads_bundled_module,
            bindings,
            reads: initializer.reads,
            is_deferred: false,
        })
    }

    /// `None` unless all that evaluating `value` does is to load a module.
    fn origin_of(&self, value: Expr, found: &Found, into: &mut Initializer) -> Option<Origin> {
        match value.data {
            // `const before = module.method` may precede `module.method = ..`.
            ExprData::EIdentifier(_) | ExprData::EDot(_) => {
                let origin = self.origin_of_chain(value, found, into)?;
                let loads = into.record.is_some() || into.loads_bundled_module;
                (loads || origin == Origin::MakerOfValues).then_some(origin)
            }
            ExprData::EObject(_) => (self.is_mere_value(value, found, into) && into.makes_value)
                .then_some(Origin::Unknown),
            _ => self.origin_of_chain(value, found, into),
        }
    }

    fn origin_of_chain(
        &self,
        value: Expr,
        found: &Found,
        into: &mut Initializer,
    ) -> Option<Origin> {
        if !self.stack_check.is_safe_to_recurse() {
            return None;
        }
        match value.data {
            ExprData::ERequireString(it) if into.record.is_none() => {
                into.record = Some(it.import_record_index);
                let record = &self.import_records.items()[it.import_record_index as usize];
                Some(match only_makes_values(record.path.text) {
                    true => Origin::MakerOfValues,
                    false => Origin::Module,
                })
            }
            ExprData::EIdentifier(it) => {
                let origin = *found.origins.get(it.ref_.inner_index() as usize)?;
                into.reads.push(it.ref_);
                (origin != Origin::Unknown).then_some(origin)
            }
            ExprData::EDot(it) if it.optional_chain.is_none() => {
                self.origin_of_chain(it.target, found, into)
            }
            // `(0, module.default)`
            ExprData::EBinary(it)
                if it.op == js_ast::OpCode::BinComma
                    && matches!(it.left.data, ExprData::ENumber(_)) =>
            {
                self.origin_of_chain(it.right, found, into)
            }
            ExprData::ECall(it) if is_require_of_bundled_module(&it, found) => {
                into.loads_bundled_module = true;
                Some(Origin::Module)
            }
            ExprData::ECall(it) if it.optional_chain.is_none() => {
                if self.is_call_of_interop_helper(&it) {
                    let (first, rest) = it.args.slice().split_first()?;
                    let is_flag =
                        |it: &Expr| matches!(it.data, ExprData::ENumber(_) | ExprData::EBoolean(_));
                    let is_whole = match first.data {
                        ExprData::ECall(it) => is_require_of_bundled_module(&it, found),
                        ExprData::ERequireString(_) | ExprData::EIdentifier(_) => true,
                        ExprData::EDot(it) => {
                            *it.name == *b"default"
                                && matches!(it.target.data, ExprData::EIdentifier(_))
                        }
                        _ => false,
                    };
                    return (is_whole && rest.iter().all(is_flag))
                        .then(|| self.origin_of_chain(*first, found, into))?;
                }
                if matches!(it.target.data, ExprData::EDot(it) if has_effect(&it.name)) {
                    return None;
                }
                let origin = self.origin_of_chain(it.target, found, into)?;
                into.makes_value = true;
                (origin == Origin::MakerOfValues
                    && (it.args.slice().iter()).all(|it| self.is_mere_value(*it, found, into)))
                .then_some(origin)
            }
            _ => None,
        }
    }

    fn loaders_of_bundled_modules(&self) -> Vec<bool> {
        let names = || self.symbols.iter().map(|it| it.original_name.slice());
        let is_by_esbuild = names().any(|it| matches!(it, b"__commonJS" | b"__commonJSMin"));
        let mut by_rollup: Vec<&[u8]> = names()
            .filter_map(|it| it.strip_prefix(b"hasRequired"))
            .collect();
        by_rollup.sort_unstable();
        let is_loader = |it: &js_ast::Symbol| match it.original_name.strip_prefix(b"require") {
            _ if it.kind == Kind::Unbound => false,
            Some([b'_', ..]) if is_by_esbuild => true,
            Some(name) => by_rollup.binary_search(&name).is_ok(),
            None => false,
        };
        self.symbols.iter().map(is_loader).collect()
    }

    fn is_call_of_interop_helper(&self, call: &E::Call) -> bool {
        let name_of = |it: Ref| {
            self.symbols[it.inner_index() as usize]
                .original_name
                .slice()
        };
        match call.target.data {
            ExprData::EIdentifier(it) => is_interop_helper(name_of(it.ref_)),
            // `tslib.__importDefault`, `_interop_require_default._`
            ExprData::EDot(dot) => match dot.target.data {
                ExprData::EIdentifier(it) => {
                    is_interop_helper(&dot.name)
                        || *dot.name == *b"_" && is_interop_helper(name_of(it.ref_))
                }
                _ => false,
            },
            _ => false,
        }
    }

    fn is_mere_value(&self, value: Expr, found: &Found, into: &mut Initializer) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return false;
        }
        match value.data {
            ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EString(_)
            | ExprData::ERegExp(_)
            | ExprData::EArrow(_)
            | ExprData::EFunction(_) => true,
            ExprData::EIdentifier(it) => {
                into.reads.push(it.ref_);
                let symbol = &self.symbols[it.ref_.inner_index() as usize];
                let varies = symbol.has_been_assigned_to()
                    || found.is_declared_again[it.ref_.inner_index() as usize];
                // What is in an array or an object can change.
                let has_no_contents = matches!(symbol.kind, Kind::HoistedFunction | Kind::Class)
                    || found.origins[it.ref_.inner_index() as usize] == Origin::MakerOfValues;
                symbol.kind != Kind::Arguments
                    && (found.has_react_compiler || !varies && has_no_contents)
            }
            ExprData::EDot(it) => {
                found.has_react_compiler && self.is_mere_value(it.target, found, into)
            }
            ExprData::EUnary(it) => matches!(it.value.data, ExprData::ENumber(_)),
            ExprData::ENew(it) => {
                let ExprData::EIdentifier(class) = it.target.data else {
                    return false;
                };
                let class = &self.symbols[class.ref_.inner_index() as usize];
                class.kind == Kind::Unbound
                    && matches!(&*class.original_name, b"Map" | b"Set")
                    && (it.args.slice().iter()).all(|it| self.is_mere_value(*it, found, into))
            }
            ExprData::EArray(it) => {
                (it.items.slice().iter()).all(|it| self.is_mere_value(*it, found, into))
            }
            ExprData::EObject(it) => it.properties.slice().iter().all(|it| {
                it.kind == G::PropertyKind::Normal
                    && !it.flags.contains(js_ast::flags::Property::IsComputed)
                    && (it.value).is_some_and(|it| self.is_mere_value(it, found, into))
            }),
            ExprData::ECall(_) => {
                let before = into.record;
                self.origin_of_chain(value, found, into) == Some(Origin::MakerOfValues)
                    && into.record == before
            }
            _ => false,
        }
    }

    fn call(&mut self, function: Ref, args: &[Expr], loc: Loc) -> Expr {
        let call = E::Call {
            target: Expr::init_identifier(function, loc),
            args: js_ast::ExprNodeList::from_slice(args),
            ..Default::default()
        };
        self.new_expr(call, loc)
    }

    /// `member`: of `value`, in which the module is `names.it`
    fn deferred(
        &mut self,
        record: Option<u32>,
        value: Expr,
        member: Option<Expr>,
        names: Names,
    ) -> Expr {
        let loc = value.loc;
        let mut args = match record {
            Some(record) => {
                let text = self.import_records.items()[record as usize].path.text;
                let specifier = self.new_expr(E::EString::init(text), loc);
                vec![self.value_for_require(loc), specifier]
            }
            None => vec![self.new_expr(E::Undefined {}, loc); 2],
        };
        let picked = match member {
            Some(index) => {
                let member = E::Index {
                    target: value,
                    index,
                    optional_chain: None,
                    is_import_property_use: false,
                };
                self.new_expr(member, loc)
            }
            None => value,
        };
        if !matches!(picked.data, ExprData::EIdentifier(id) if id.ref_ == names.it) {
            let value = Some(picked);
            let body = self.s(S::Return { value }, loc);
            args.push(arrow(self.arena, names.it, body));
        }
        let mut keys = Vec::from_iter(member);
        let mut object = value;
        while let ExprData::EDot(it) = object.data {
            keys.push(self.new_expr(E::EString::init(it.name.slice()), loc));
            object = it.target;
        }
        keys.reverse();
        match object.data {
            _ if keys.is_empty() => {}
            ExprData::EIdentifier(id) if id.ref_ == names.it => {
                let items = js_ast::ExprNodeList::from_slice(&keys);
                let keys = E::Array {
                    items,
                    ..Default::default()
                };
                args.push(self.new_expr(keys, loc))
            }
            _ => args.push(self.new_expr(E::Boolean { value: true }, loc)),
        }
        self.call(names.defer, &args, loc)
    }

    fn rewrite(&mut self, candidate: &Candidate, names: Names) {
        let record = candidate.record;
        let without_require = |mut value: Expr| {
            if record.is_some() {
                let it = Expr::init_identifier(names.it, value.loc);
                replace_require(&mut value, it);
            }
            value
        };
        match candidate.place {
            Place::Declaration(mut local, at) => {
                let G::Decl { binding, value } = local.decls.slice()[at];
                let Some(value) = value.map(without_require) else {
                    return;
                };
                let decls: Vec<G::Decl> = match binding.data {
                    BindingData::BObject(object) => (object.properties.slice().iter())
                        .map(|it| G::Decl {
                            binding: it.value,
                            value: Some(self.deferred(record, value, Some(it.key), names)),
                        })
                        .collect(),
                    _ => vec![G::Decl {
                        binding,
                        value: Some(self.deferred(record, value, None, names)),
                    }],
                };
                local.decls.splice(at..=at, decls);
                for binding in &candidate.bindings {
                    self.symbols[binding.inner_index() as usize].set_is_deferred_require(true);
                }
            }
            Place::Property(mut object, at) => {
                let property = &mut object.properties.slice_mut()[at];
                property.value = (property.value.map(without_require))
                    .map(|value| self.deferred(record, value, None, names));
                (property.flags).insert(js_ast::flags::Property::IsDeferredRequire);
            }
            Place::Export(assignment, mut statement) => {
                let ExprData::EDot(left) = assignment.left.data else {
                    return;
                };
                let loc = assignment.left.loc;
                let right = self.deferred(record, without_require(assignment.right), None, names);
                let key = self.new_expr(E::EString::init(left.name.slice()), loc);
                let value = self.module_scope().strict_mode != js_ast::StrictModeKind::SloppyMode;
                let is_strict = self.new_expr(E::Boolean { value }, loc);
                let set = E::Call {
                    target: self.new_expr(
                        E::Dot {
                            target: Expr::init_identifier(names.lazy, loc),
                            name: js_ast::StoreStr::new(b"set"),
                            name_loc: loc,
                            ..Default::default()
                        },
                        loc,
                    ),
                    args: js_ast::ExprNodeList::from_slice(&[left.target, key, right, is_strict]),
                    ..Default::default()
                };
                statement.value = self.new_expr(set, loc);
            }
        }
    }

    /// See [`LOADS`]
    pub(crate) fn comment_on_loads(&mut self, depth: u32) -> Stmt {
        let mut text = LOADS.to_vec();
        text.push(b'0' + depth.min(9) as u8);
        let records = self.import_records.items();
        let imports = (records.iter()).filter(|it| {
            it.kind == ImportKind::Stmt && !it.flags.contains(js_ast::ImportRecordFlags::IS_UNUSED)
        });
        let WhileLoading {
            requires, deferred, ..
        } = &self.while_loading;
        let requires = requires.iter().map(|it| {
            let at = deferred.binary_search_by_key(it, |it| it.0);
            (at.map_or(b'r', |at| deferred[at].1), &records[*it as usize])
        });
        for (kind, record) in imports.map(|it| (b'i', it)).chain(requires) {
            let specifier = record.path.text;
            if strings::is_all_ascii(specifier)
                && strings::index_of_any(specifier, b"\t\r\n").is_none()
            {
                text.extend_from_slice(&[b'\t', kind]);
                text.extend_from_slice(specifier);
            }
        }
        let text = js_ast::StoreStr::new(self.arena.alloc_slice_copy(&text));
        self.s(S::Comment { text }, Loc::EMPTY)
    }
}

fn is_require_of_bundled_module(call: &E::Call, found: &Found) -> bool {
    matches!(call.target.data, ExprData::EIdentifier(it)
        if call.args.is_empty() && found.loads_bundled_module[it.ref_.inner_index() as usize])
}

/// `value` is one that `origin_of_chain` has accepted.
fn replace_require(value: &mut Expr, with: Expr) {
    let mut at = value;
    loop {
        at = match &mut at.data {
            ExprData::EDot(it) => &mut it.target,
            ExprData::EBinary(it) => &mut it.right,
            ExprData::ECall(it) => {
                let it: &mut E::Call = it;
                match it.args.slice_mut().first_mut() {
                    Some(first) if matches!(first.data, ExprData::ERequireString(_)) => first,
                    _ => &mut it.target,
                }
            }
            data => {
                *data = with.data;
                return;
            }
        };
    }
}

fn arrow(arena: &Arena, parameter: Ref, body: Stmt) -> Expr {
    let loc = body.loc;
    let args = arena.alloc_slice_fill_iter([G::Arg {
        binding: js_ast::Binding::alloc(arena, B::Identifier { r#ref: parameter }, loc),
        ..Default::default()
    }]);
    Expr::init(
        E::Arrow {
            args: js_ast::StoreSlice::new_mut(args),
            body: G::FnBody {
                loc,
                stmts: js_ast::StoreSlice::new_mut(arena.alloc_slice_copy(&[body])),
            },
            prefer_expr: true,
            ..Default::default()
        },
        loc,
    )
}
