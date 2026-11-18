use core::cell::RefCell;
use core::fmt::Write;
use core::ops::Range;
use std::rc::Rc;

use bun_engine_syntax::{FieldKind, FieldSource, SourceCache};
use bun_engine_text::{Atom, Identifier, PropertyName, StringRef, SymbolRef, Text, private_names};

use super::support::Random;
use crate::cache::*;
use crate::function::{Fields, FunctionName};
use crate::*;

const SCRIPT: &str = r#"
var hoisted = 1, { a = 2, ...others } = { b: 3, ["c" + 1]: 4, __proto__: null }; let counter = 10n; const π = 3.14;
{ function inBlock() { return hoisted; } }
function plain(x, y = x, ...rest) { return [x, ...rest, , y, -0, NaN, 1e21, 0x7fffffff, -2147483648]; }
function lists() { return [[1, 2, 3], [1.5, 2], ["a", "é", "日本語"], [null, true, "x", 5n, 0.5]]; }
function* generator(limit) { for (let i = 0; i < limit; i++) { try { yield () => i; } finally { counter++; } } yield* [1]; }
async function waits(stream) { for await (const item of stream) { if (await item) break; } using it = null; }
async function* both() { const kept = await 1; yield kept; }
function switches(v) {
    switch (v) { case 1: case 2: return 1; case 4: return 2; }
    switch (v) { case -5: return 3; case 100000: return 4; case 7: return 5; }
    switch (v) { case "a": return 6; case "b": return 7; case "c": return 8; }
    switch (v) { case "one": return 9; case "": return 10; case "три": return 11; default: return 12; }
}
class Base { static #count = 0; #x = 1; [hoisted] = 2; name; static { Base.#count++; } get x() { return this.#x; }
    set x(v) { this.#x = v; } #secret() { return super.toString(); } static has(o) { return #x in o; } }
class Derived extends Base { constructor() { super(); this.f = () => new.target; } static async *[Symbol.iterator]() {} }
const Empty = class extends Base {}, Branded = class { #only() {} };
function dynamic(o) { with (o) { var v = eval("x"); return function named() { return named + v + arguments.length; }; } }
function text(tag) { return tag`a${1}\unicode${2}` + `b${tag}` + /x+/giu.source + 0b11n + 0xffn + -7n; }
function contexts() { return [function () { }, () => 1, "\u6261\u6463", "abcd"]; }
function mapped(p, q) { p = 1; return arguments[0] + (() => q)(); }
function escaped() { var \u{62}ound = 1; return () => bound; }
label: for (var key in others) { for (const [l, r] of key) { if (l) continue label; else break label; } }
"a string that is longer than what is worth an atom, which is sixty-four characters or so";
//# sourceURL=script.js
//# sourceMappingURL=script.js.map
"#;

const MODULE: &str = r#"
import first, { second as renamed, "a b" as spaced } from "one";
import * as all from "two" with { type: "json" };
import defer * as later from "three";
export * from "four"; export * as five from "five"; export { six as seven } from "six"; export { all };
export default function () { return first + renamed + spaced + later + import.meta.url; }
export function lazy() { return lazy; }
export let state = await import("eight");
export class Thing { field = state; }
"#;

const BUILTIN: &str = r#"(function (value) { "use strict";
    if (!@isObject(value)) @throwTypeError("no object");
    const inner = function () { return value.@hostName + value.@@iterator + @hostValue; };
    class Local {}
    return @getByIdDirectPrivate(value, "hostName") ?? inner() ?? Local;
})"#;

struct TestHost {
    symbol: Option<Identifier>,
}

impl Host for TestHost {
    fn private_name(&self, name: Text<'_>) -> Option<Identifier> {
        self.symbol.clone().filter(|_| name.eq_ascii("hostName"))
    }

    fn builtin_value(&self, name: PropertyName<'_>) -> Option<BuiltinValue> {
        (name.text().eq_ascii("hostValue")).then_some(BuiltinValue::LinkTime(LinkTimeConstant(40)))
    }

    fn version(&self) -> u32 {
        8
    }
}

fn host() -> Rc<TestHost> {
    let names = ["hostName", "hostValue", "isObject", "throwTypeError"];
    let symbol = SymbolRef::private(&StringRef::from_literal(names[0]));
    Rc::new(TestHost {
        symbol: Some(symbol.into()),
    })
}

struct AnyName;

impl Host for AnyName {
    fn private_name(&self, name: Text<'_>) -> Option<Identifier> {
        thread_local!(static NAMES: RefCell<Vec<Identifier>> = const { RefCell::new(Vec::new()) });
        NAMES.with_borrow_mut(|names| {
            if !names.iter().any(|it| it.name().text() == name) {
                names.push(SymbolRef::private(&StringRef::from_text(name)).into());
            }
            names.iter().find(|it| it.name().text() == name).cloned()
        })
    }

    fn builtin_value(&self, name: PropertyName<'_>) -> Option<BuiltinValue> {
        host().builtin_value(name)
    }

    fn version(&self) -> u32 {
        7
    }
}

const STAMP: u32 = 5;
const ALL: u32 = u32::MAX;

enum Unit {
    Script(Script),
    Module(Module),
    Function(FunctionRef),
}

struct Case {
    goal: Goal,
    source: StringRef,
    outer: Option<Rc<StaticScope>>,
}

impl Case {
    fn new(goal: Goal, source: &str) -> Case {
        Case {
            goal,
            source: StringRef::from_str(source),
            outer: None,
        }
    }

    fn all() -> [Case; 3] {
        [
            Case::new(Goal::Script, SCRIPT),
            Case::new(Goal::Module, MODULE),
            Case::new(Goal::Builtin, BUILTIN),
        ]
    }

    fn key(&self) -> Key<'_> {
        match self.goal {
            Goal::Builtin => Key::of_builtin(&self.source, STAMP, &AnyName),
            goal => Key::of_program(&self.source, goal),
        }
    }

    fn request<'a>(&'a self, cache: Option<&'a mut SourceCache>) -> Request<'a> {
        let marker = 0u8;
        Request {
            source: &self.source,
            cache,
            host: &AnyName,
            instrumentation: Instrumentation::empty(),
            stack_limit: (&raw const marker).addr() - (1 << 20),
        }
    }

    fn builtin(&self) -> FunctionRef {
        BuiltinFunction {
            name: Identifier::from_literal("builtin"),
            range: 1..self.source.len() as u32 - 1,
            parameters_start: 10,
            length: 1,
            kind: FunctionKind::Normal,
            is_strict: true,
            is_async: false,
            is_generator: false,
            visibility: Visibility::Private,
            has_positions: true,
        }
        .into_function()
    }

    fn compile(&self) -> Unit {
        let (mut compiler, outer) = (Compiler::default(), self.outer.clone());
        let request = self.request(None);
        match self.goal {
            Goal::Script => Unit::Script(compiler.script(request, false, outer).ok().unwrap()),
            Goal::Builtin => Unit::Function(self.builtin()),
            _ => Unit::Module(compiler.module(request, false, outer).ok().unwrap()),
        }
    }

    fn code(&self, function: &FunctionInfo, entered: Specialization) -> Option<Rc<Code>> {
        function.load_code(entered, Instrumentation::empty(), &AnyName)
    }

    fn add(&self, output: Output<'_>, cache: Option<&mut SourceCache>) -> Result<(), Unencodable> {
        let (compiler, request) = (&mut Compiler::default(), self.request(cache));
        match self.goal {
            Goal::Builtin => output.add_builtin(compiler, request, &self.builtin(), STAMP),
            goal => output.add_program(compiler, request, goal),
        }
    }

    fn encode_with(&self, depth: u32, cache: Option<&mut SourceCache>) -> Vec<u8> {
        let mut encoder = Encoder::default();
        self.add(output(&mut encoder, depth), cache).unwrap();
        encoder.finish().unwrap().payload
    }

    fn encode(&self, depth: u32) -> Vec<u8> {
        self.encode_with(depth, None)
    }

    fn add_unit(&self, output: Output<'_>, unit: &Unit) -> Result<(), Unencodable> {
        let mut compiler = Compiler::default();
        let generate = &mut |function: &FunctionInfo| {
            let entered = function.likely_specialization();
            (compiler.function(self.request(None), function, entered)).ok()
        };
        output.add(unit.root(), &self.key(), &AnyName, Some(generate))
    }

    /// With what has no code compiled on the way.
    fn encode_unit(&self, unit: &Unit, depth: u32) -> Vec<u8> {
        let mut encoder = Encoder::default();
        self.add_unit(output(&mut encoder, depth), unit).unwrap();
        encoder.finish().unwrap().payload
    }

    fn load(&self, loader: &Rc<Loader>, payload: &Payload, entry: u32) -> Option<Unit> {
        let (key, host, outer) = (&self.key(), &AnyName, self.outer.as_ref());
        Some(match self.goal {
            Goal::Script => Unit::Script(loader.script(payload, entry, key, host, outer)?.root),
            Goal::Builtin => {
                let function = self.builtin();
                loader.builtin(payload, entry, key, host, &function)?;
                Unit::Function(function)
            }
            _ => Unit::Module(loader.module(payload, entry, key, host, outer, true)?.root),
        })
    }

    fn digest(&self, loader: &Rc<Loader>, payload: &Payload, entry: u32) -> Option<Digest> {
        let builtin = (self.goal == Goal::Builtin).then(|| self.builtin());
        let at = (payload, entry);
        Digest::of(loader, at, &self.key(), &AnyName, builtin.as_ref())
    }

    /// The same.
    fn describe(&self, unit: &Unit) -> String {
        self.describe_with(unit, |dump| dump.with_positions())
    }

    fn describe_with(&self, unit: &Unit, detail: impl Fn(Dump<'_>) -> Dump<'_>) -> String {
        let (mut text, mut compiler) = (String::new(), Compiler::default());
        let mut pending = vec![];
        let mut visit = |text: &mut String, function: &FunctionInfo, pending: &mut Vec<_>| {
            describe_function(text, function, self.source.text());
            for specialization in [Specialization::Call, Specialization::Construct] {
                if specialization == Specialization::Call || function.is_constructor() {
                    pending.extend(self.code(function, specialization).or_else(|| {
                        let request = self.request(None);
                        compiler.function(request, function, specialization).ok()
                    }));
                }
            }
        };
        match unit {
            Unit::Script(script) => {
                let it = &script.declarations;
                let lists = [&it.variables, &it.functions, &it.hoisted_functions];
                write!(text, "{lists:?} {:?} {:?}", it.lets, it.constants).unwrap();
                describe_directives(&mut text, &script.directives);
                pending.push(Rc::clone(&script.code));
            }
            Unit::Module(module) => {
                describe_interface(&mut text, module);
                describe_directives(&mut text, &module.directives);
                describe_chain(&mut text, Some(&module.scope));
                pending.push(Rc::clone(&module.code));
            }
            Unit::Function(function) => visit(&mut text, function, &mut pending),
        }
        while let Some(code) = pending.pop() {
            let dump = detail(Dump::new(&code, self.source.text()));
            write!(text, "{dump}{:?}", code.name_lists).unwrap();
            for scope in &code.scopes {
                describe_chain(&mut text, Some(scope));
            }
            for function in &*code.functions {
                visit(&mut text, function, &mut pending);
            }
        }
        text
    }
}

impl Unit {
    fn root(&self) -> Root<'_> {
        match self {
            Unit::Script(script) => Root::Script(script),
            Unit::Module(module) => Root::Module(module),
            Unit::Function(function) => Root::Builtin(function),
        }
    }

    fn code(&self) -> &Rc<Code> {
        match self {
            Unit::Script(Script { code, .. }) | Unit::Module(Module { code, .. }) => code,
            Unit::Function(_) => unreachable!(),
        }
    }
}

fn describe_directives(text: &mut String, directives: &Directives) {
    let urls = [&directives.source_url, &directives.source_mapping_url];
    writeln!(text, "{:?}", urls.map(|it| it.as_ref().map(|it| it.text()))).unwrap();
}

fn describe_interface(text: &mut String, module: &Module) {
    for it in &module.requests {
        writeln!(text, "{} {:?} {:?}", it.specifier, it.attributes, it.phase).unwrap();
    }
    for it in &module.imports {
        let (request, slot) = (it.request, it.slot);
        writeln!(text, "{request} {:?} {} {slot}", it.imported, it.local).unwrap();
    }
    for it in &module.exports {
        match it {
            ExportEntry::Local { exported, slot } => writeln!(text, "{exported} {slot}"),
            ExportEntry::Indirect {
                exported,
                request,
                imported,
            } => writeln!(text, "{exported} {request} {imported:?}"),
            ExportEntry::Star { request } => writeln!(text, "{request}"),
        }
        .unwrap();
    }
}

fn describe_chain(text: &mut String, innermost: Option<&Rc<StaticScope>>) {
    for it in core::iter::successors(innermost, |scope| scope.parent()) {
        let counts = [it.slot_count, it.undefined_slots, it.mapped_parameters];
        let options = [it.eval_variables_slot, it.entered_at];
        writeln!(text, "{:?} {counts:?} {options:?}", it.kind).unwrap();
        for slot in it.slots() {
            let name = it.name_of(slot);
            let is_found = it
                .find(name.name())
                .is_some_and(|it| it.index == slot.index);
            let numbers = [slot.hash, slot.index, slot.detail];
            let (kind, flags) = (slot.kind, slot.flags);
            writeln!(text, "{name} {is_found} {numbers:?} {kind:?} {flags:?}").unwrap();
        }
    }
}

fn describe_function(text: &mut String, it: &FunctionInfo, source: Text<'_>) {
    let numbers = [it.start, it.parameters_start, it.end, it.length];
    let traits = (it.kind, it.flags, it.origin, it.visibility, it.context);
    let declared = (it.instance_fields, it.bare_fields);
    let more = (it.has_own_name, declared, it.created_at);
    let (name, range, fields) = (it.name(source), &it.text, &it.fields);
    writeln!(
        text,
        "{name:?} {numbers:?} {traits:?} {more:?} {range:?} {fields:?}"
    )
    .unwrap();
    describe_chain(text, it.scope.as_ref());
}

fn output(encoder: &mut Encoder, depth: u32) -> Output<'_> {
    Output {
        encoder,
        strings: None,
        names: None,
        depth,
    }
}

fn loader() -> Rc<Loader> {
    Rc::default()
}

fn intact(bytes: &[u8]) -> Payload {
    Payload::intact(bytes.into())
}

fn embedded(bytes: &[u8]) -> Payload {
    Payload::embedded(bytes.to_vec().leak())
}

#[test]
fn round_trips() {
    for case in Case::all() {
        let (all, described) = (case.encode(ALL), case.describe(&case.compile()));
        for depth in [0, 1, 2, ALL] {
            let bytes = case.encode(depth);
            for payload in [intact(&bytes), embedded(&bytes)] {
                let Some(loaded) = case.load(&loader(), &payload, 0) else {
                    assert!(case.goal == Goal::Builtin && !payload.is_embedded());
                    continue;
                };
                assert_eq!(case.encode_unit(&loaded, depth), bytes);
                assert_eq!(case.encode_unit(&loaded, ALL), all);
                assert_eq!(case.describe(&loaded), described);
            }
        }
    }
}

#[test]
fn all_code_is_accepted() {
    for case in &Case::all()[..2] {
        let bytes = case.encode(ALL);
        let digest = case.digest(&loader(), &intact(&bytes), 0).unwrap();
        assert_eq!(case.digest(&loader(), &embedded(&bytes), 0), Some(digest));
    }
}

#[test]
fn a_module_that_the_embedder_has_analyzed() {
    let case = Case::new(Goal::Module, MODULE);
    let payload = intact(&case.encode(ALL));
    let module = loader().module(&payload, 0, &case.key(), &AnyName, None, false);
    let module = module.unwrap().root;
    assert!(module.requests.is_empty() && module.imports.is_empty() && module.exports.is_empty());
    assert!(!module.has_interface && module.code.body.is_stored());
}

#[test]
fn code_with_hooks_is_not_stored() {
    let case = Case::new(Goal::Script, "x");
    for instrumentation in [Instrumentation::DEBUGGER, Instrumentation::COVERAGE] {
        let request = Request {
            instrumentation,
            ..case.request(None)
        };
        let result = output(&mut Encoder::default(), ALL).add_program(
            &mut Compiler::default(),
            request,
            case.goal,
        );
        assert_eq!(result, Err(Unencodable));
    }
}

#[test]
fn the_bytes_depend_on_the_source_alone() {
    for case in Case::all() {
        let bytes = case.encode(ALL);
        let _atoms = ["others", "limit", "hostName"].map(|name| {
            let units: Vec<u16> = name.encode_utf16().collect();
            Atom::from_string(&StringRef::from_text(Text::Utf16(&units)))
        });
        let mut cache = SourceCache::default();
        for _ in 0..2 {
            assert_eq!(case.encode_with(ALL, Some(&mut cache)), bytes);
        }
        let on_another_thread = std::thread::scope(|scope| {
            let (goal, text) = (case.goal, case.source.text().to_string());
            let encode = move || Case::new(goal, &text).encode(ALL);
            scope.spawn(encode).join().unwrap()
        });
        assert_eq!(on_another_thread, bytes);
    }
}

#[test]
fn the_width_of_the_source_does_not_show() {
    let source = format!("function f() {{ return '{}' }}", "é".repeat(2000));
    let narrow = Case::new(Goal::Script, &source);
    let mut wide = Case::new(Goal::Script, "");
    let units: Vec<u16> = source.encode_utf16().collect();
    wide.source = StringRef::from_text(Text::Utf16(&units));
    assert!(narrow.source.text().is_latin1() && !wide.source.text().is_latin1());
    let bytes = narrow.encode(ALL);
    assert_eq!(wide.encode(ALL), bytes);
    let loaded = wide.load(&loader(), &intact(&bytes), 0).unwrap();
    assert_eq!(wide.describe(&loaded), narrow.describe(&narrow.compile()));
}

#[test]
fn another_key_is_a_miss() {
    let case = Case::new(Goal::Script, "x");
    let bytes = case.encode(0);
    let (loader, key) = (loader(), case.key());
    let loads = |payload: &Payload, entry, key: &Key<'_>| {
        (loader.script(payload, entry, key, &AnyName, None)).is_some()
    };
    let (other, longer) = (StringRef::from_literal("y"), StringRef::from_literal("x;"));
    let unidentified = |source| Key {
        source,
        identity: None,
        ..key
    };
    let high_bit = Key {
        identity: key.identity.map(|it| it ^ 1 << 63),
        ..key
    };
    for payload in [intact(&bytes), embedded(&bytes)] {
        assert!(loads(&payload, 0, &key));
        assert!(!loads(&payload, 1, &key) && !loads(&payload, u32::MAX, &key));
        assert!(!loads(&payload, 0, &Key::of_program(&other, Goal::Script)));
        assert!(!loads(&payload, 0, &high_bit) && !loads(&payload, 0, &unidentified(&longer)));
        let is_trusted = payload.is_embedded();
        assert_eq!(loads(&payload, 0, &unidentified(key.source)), is_trusted);
    }
    assert!(!Key::of_program(key.source, Goal::Module).opens(&bytes));
    assert!(key.opens(&bytes[..Key::BYTES]) && !key.opens(&bytes[..Key::BYTES - 1]));
    for at in 0..Key::BYTES {
        let mut flipped = bytes.clone();
        flipped[at] ^= 1;
        assert!(!key.opens(&flipped));
    }
}

#[test]
fn inside_a_scope_of_the_embedder() {
    let source = "export function f() { return [() => tenant, () => other, () => undefined] }";
    let scope = |kind, name| {
        let names = [Identifier::from_literal(name)].into();
        Some(StaticScope::of_names(kind, None, names))
    };
    let mut case = Case::new(Goal::Module, source);
    let payload = intact(&case.encode(ALL));
    case.outer = scope(ScopeKind::Block, "tenant");
    let loaded = case.load(&loader(), &payload, 0).unwrap();
    let f = case.code(&loaded.code().functions[0], Specialization::Call);
    let is_loaded = |it| case.code(it, Specialization::Call).is_some();
    let arrows: Vec<_> = f
        .as_ref()
        .unwrap()
        .functions
        .iter()
        .map(is_loaded)
        .collect();
    assert_eq!(arrows, [false, true, true]);
    assert_eq!(case.describe(&loaded), case.describe(&case.compile()));

    for outer in [
        scope(ScopeKind::Block, "undefined"),
        scope(ScopeKind::Function, "tenant"),
        Some(StaticScope::with(case.outer.clone())),
        Some(StaticScope::for_this(None)),
    ] {
        case.outer = outer;
        assert!(case.load(&loader(), &payload, 0).is_none());
    }
}

#[test]
fn scopes_of_the_embedder_share_code() {
    let mut case = Case::new(Goal::Module, "export default [() => a, () => () => a]");
    let (loader, payload) = (loader(), embedded(&case.encode(ALL)));
    let mut codes_in = |name: Option<&'static str>| {
        let names = name.map(|it| [Identifier::from_literal(it)].into());
        case.outer = names.map(|it| StaticScope::of_names(ScopeKind::Block, None, it));
        let loaded = case.load(&loader, &payload, 0).unwrap();
        [0, 1].map(|it| case.code(&loaded.code().functions[it], Specialization::Call))
    };
    let [first, second, naming] = [Some("b"), None, Some("a")].map(&mut codes_in);
    let is_same = |index: usize| {
        Rc::ptr_eq(
            first[index].as_ref().unwrap(),
            second[index].as_ref().unwrap(),
        )
    };
    assert!(is_same(0) && !is_same(1) && naming[0].is_none());
    assert_eq!(Rc::strong_count(first[0].as_ref().unwrap()), 2);
    drop((first, second));
    assert!(codes_in(None)[0].is_some());
}

#[test]
fn what_is_cut_short_is_a_miss_or_incomplete() {
    for case in Case::all() {
        let describe = |unit| case.describe_with(&unit, |dump| dump);
        let (bytes, described) = (case.encode(ALL), describe(case.compile()));
        for at in (0..bytes.len()).step_by(7) {
            if let Some(unit) = case.load(&loader(), &intact(&bytes[..at]), 0) {
                case.describe(&unit);
                assert!(describe(unit) == described);
            }
        }
    }
}

#[test]
fn instructions_stay_where_they_are() {
    let case = Case::new(Goal::Script, "function f() { }");
    let payload = intact(&case.encode(ALL));
    let range = payload.bytes().as_ptr_range();
    let loaded = case.load(&loader(), &payload, 0).unwrap();
    let code = case.code(&loaded.code().functions[0], Specialization::Call);
    drop((payload, loaded));
    assert!(range.contains(&code.unwrap().body.instructions().as_ptr()));
}

#[test]
fn changed_bytes_are_refused_or_well_formed() {
    let (loader, mut loaded) = (loader(), 0);
    for (seed, case) in (0..).zip(&Case::all()[..2]) {
        for depth in [1, ALL] {
            let bytes = case.encode(depth);
            let random = &mut Random::new(seed);
            for _ in 0..400 {
                let mut bytes = bytes.clone();
                for _ in 0..=random.skewed_below(4) {
                    let at = random.below(bytes.len() as u32) as usize;
                    match random.below(4) {
                        0 => bytes[at] ^= 1 << random.below(8),
                        1 => bytes[at] = bytes[at].wrapping_add(random.pick(&[1, 0xff])),
                        2 => bytes[at] = random.pick(&[0, 0x7f, 0x80, 0xff]),
                        _ => bytes[at] = random.next() as u8,
                    }
                }
                if let Some(unit) = case.load(&loader, &intact(&bytes), 0) {
                    case.describe(&unit);
                    loaded += 1;
                }
            }
        }
    }
    assert!(loaded > 500, "{loaded}");
}

#[test]
fn a_record_that_contains_itself_ends() {
    let case = Case::new(Goal::Script, "(function () { (function () { }) })");
    let mut bytes = case.encode(ALL);
    let loader = observed(&[]);
    case.digest(&loader, &embedded(&bytes), 0).unwrap();
    let [(outer, _), (inner, _)] = FUNCTIONS.take()[..] else {
        unreachable!()
    };
    let at = (outer as usize..inner as usize)
        .find(|&at| bytes[at..at + 4] == inner.to_le_bytes())
        .unwrap();
    bytes[at..at + 4].copy_from_slice(&outer.to_le_bytes());
    assert!(case.digest(&loader, &intact(&bytes), 0).is_none());
}

fn code_of(module: &mut Module) -> &mut Code {
    Rc::get_mut(&mut module.code).unwrap()
}

fn function_of(module: &mut Module) -> &mut FunctionInfo {
    &mut Rc::get_mut(&mut code_of(module).functions).unwrap()[0]
}

fn body_of(module: &mut Module) -> &mut Body {
    &mut code_of(module).body
}

fn scope_of(module: &mut Module) -> &mut StaticScope {
    function_of(module).scope = None;
    Rc::get_mut(&mut module.scope).unwrap()
}

#[test]
fn what_is_not_well_formed_is_refused() {
    let case = Case::new(
        Goal::Module,
        "import a from 'b'; export let c; export function d() {}",
    );
    let past = case.source.len() as u32 + 1;
    let values =
        |values: [Constant; 1]| Constant::Array(Rc::new(ArrayLiteral::Values(values.into())));
    let fields = |start, key_start, initializer_start| {
        let source = FieldSource {
            kind: FieldKind::Named,
            start,
            key_start,
            initializer_start,
        };
        move |module: &mut Module| {
            function_of(module).kind = FunctionKind::FieldInitializer;
            function_of(module).fields = Some(Box::new(Fields {
                sources: [source].into(),
                key_slots: [0].into(),
                sets_brand: false,
            }));
        }
    };
    let accepts = |damage: &dyn Fn(&mut Module)| {
        let Unit::Module(mut module) = case.compile() else {
            unreachable!()
        };
        damage(&mut module);
        let scope = Rc::clone(&module.scope);
        function_of(&mut module).scope.get_or_insert(scope);
        let payload = intact(&case.encode_unit(&Unit::Module(module), 0));
        case.load(&loader(), &payload, 0).is_some()
    };
    assert!(accepts(&|m| scope_of(m).mapped_parameters = 4));
    assert!(accepts(&fields(1, 2, 3)));
    let damages: &[&dyn Fn(&mut Module)] = &[
        &|m| body_of(m).locals = 0,
        &|m| body_of(m).flags -= CodeFlags::STRICT,
        &|m| code_of(m).identifiers = [private_names::starDefault.to_identifier()].into(),
        &|m| code_of(m).constants = [Constant::LinkTime(LinkTimeConstant::FIRST_OF_HOST)].into(),
        &|m| code_of(m).constants = [values([values([Constant::Null])])].into(),
        &|m| function_of(m).flags -= FunctionFlags::STRICT,
        &|m| function_of(m).origin |= Origin::DEFAULT_CONSTRUCTOR,
        &|m| function_of(m).end = past,
        &|m| function_of(m).text.end = past,
        &|m| function_of(m).text.start = past,
        &|m| function_of(m).parameters_start = 0,
        &|m| function_of(m).parameters_start = past,
        &fields(2, 1, 3),
        &fields(1, past, 3),
        &fields(1, 2, past),
        &|m| function_of(m).flags |= FunctionFlags::AWAITS,
        &|m| function_of(m).flags |= FunctionFlags::EXPRESSION_BODY,
        &|m| function_of(m).kind = FunctionKind::NakedConstructor,
        &|m| function_of(m).kind = FunctionKind::BaseConstructor,
        &|m| {
            let block = StaticScope::of_names(ScopeKind::Block, None, [].into());
            function_of(m).scope = Some(Rc::clone(&block));
            code_of(m).scopes = [block].into();
        },
        &|m| code_of(m).scopes = [StaticScope::of_exports([].into())].into(),
        &|m| scope_of(m).kind = ScopeKind::Block,
        &|m| scope_of(m).slot_count = 3,
        &|m| scope_of(m).slot_count = Body::MAX_FRAME_WORDS + 1,
        &|m| scope_of(m).undefined_slots = 5,
        &|m| scope_of(m).mapped_parameters = 5,
        &|m| scope_of(m).eval_variables_slot = Some(4),
        &|m| scope_of(m).slots[1].index = 1,
        &|m| scope_of(m).slots[2].detail = 1,
        &|m| m.imports[0].request = 1,
        &|m| m.imports[0].slot = 4,
        &|m| m.imports[0].slot = 2,
        &|m| m.imports[0].imported = None,
        &|m| m.imports[0].local = Atom::from_literal("c"),
        &|m| m.imports = [].into(),
        &|m| scope_of(m).slots[1].hash ^= 1,
        &|m| {
            fields(1, 2, 3)(m);
            function_of(m).fields.as_mut().unwrap().sets_brand = true;
        },
        &|m| m.exports[0] = ExportEntry::Star { request: 1 },
    ];
    for (index, damage) in damages.iter().enumerate() {
        assert!(!accepts(damage), "{index}");
    }
}

#[test]
fn a_record_is_for_its_kind_of_function() {
    let source = "x = [function () { }, function () { 'use strict'; }, function* () { }, async function () { },
        async function () { await 1; }, () => { }, class { constructor() { } }, class { }, class extends x { }]";
    let case = Case::new(Goal::Script, source);
    let bytes = case.encode(ALL);
    case.digest(&observed(&[]), &embedded(&bytes), 0).unwrap();
    let records: Vec<_> = FUNCTIONS.take().iter().map(|it| it.0).collect();
    let references = records.iter().map(|record| {
        let is_here = |&at: &usize| bytes[at..].starts_with(&record.to_le_bytes());
        (Key::BYTES..records[0] as usize).find(is_here).unwrap()
    });
    for (at, own) in references.zip(&records) {
        for record in &records {
            let mut bytes = bytes.clone();
            bytes[at..][..4].copy_from_slice(&record.to_le_bytes());
            let digest = case.digest(&loader(), &intact(&bytes), 0);
            assert_eq!(digest.is_some(), record == own);
        }
    }
}

#[test]
fn a_long_chain_of_scopes() {
    let case = Case::new(Goal::Module, "function d() {}");
    let Unit::Module(mut module) = case.compile() else {
        unreachable!()
    };
    let block = |parent| Some(StaticScope::of_names(ScopeKind::Block, parent, [].into()));
    let chain = core::iter::successors(block(None), |it| block(Some(Rc::clone(it))));
    code_of(&mut module).scopes = chain.take(200_000).collect();
    let payload = intact(&case.encode_unit(&Unit::Module(module), 0));
    let loaded = case.load(&loader(), &payload, 0).unwrap();
    let innermost = Rc::clone(loaded.code().scopes.last().unwrap());
    drop(loaded);
    assert!(!innermost.declares_private_name(Text::from_ascii("#x")));
}

#[test]
fn arrays_nested_without_end() {
    let case = Case::new(Goal::Script, &format!("[{}]", "null,".repeat(200_000)));
    let mut bytes = case.encode(0);
    let (null, array) = (2 << 2 | 3, 14 << 2 | 3);
    let first = (0..bytes.len()).find(|&at| bytes[at..].starts_with(&[null; 64]));
    for pair in bytes[first.unwrap()..][..200_000].as_chunks_mut().0 {
        *pair = [array, 1];
    }
    assert!(case.load(&loader(), &intact(&bytes), 0).is_none());
}

#[test]
fn a_part_of_the_source_that_is_not_there() {
    let case = Case::new(Goal::Script, &format!("'{}'", "p".repeat(2000)));
    let mut bytes = case.encode(0);
    let at = (0..bytes.len() - 3).find(|&at| bytes[at..at + 3] == [1, 0xd0, 15]);
    bytes[at.unwrap()] = 3;
    assert!(case.load(&loader(), &intact(&bytes), 0).is_none());
}

#[test]
fn a_builtin_gets_its_code_again() {
    let case = Case::new(
        Goal::Builtin,
        &format!("{:2000}}})", &BUILTIN[..BUILTIN.len() - 2]),
    );
    let (payload, function) = (embedded(&case.encode(ALL)), case.builtin());
    let (host, ignorant) = (host(), TestHost { symbol: None });
    let load = |key: &Key<'_>, host| loader().builtin(&payload, 0, key, host, &function);
    assert!(load(&Key::of_builtin(&case.source, STAMP + 1, &AnyName), &*host).is_none());
    assert!(load(&Key::of_builtin(&case.source, STAMP, &*host), &*host).is_none());
    assert!(load(&case.key(), &ignorant).is_none());
    assert!(!function.is_stored() && function.code(Specialization::Call).is_none());
    assert!(load(&case.key(), &*host).unwrap().lines.is_some());
    let code = function.code(Specialization::Call).unwrap();
    assert!(code.identifiers.contains(host.symbol.as_ref().unwrap()));
    function.set_code(Specialization::Call, None);
    let again = case.code(&function, Specialization::Call).unwrap();
    assert!(again.body.is_stored());
}

#[test]
fn a_failed_entry_leaves_nothing() {
    let [good, ..] = Case::all();
    let bad = Case::new(Goal::Script, "x = function () { x = function () { } }");
    let unit = bad.compile();
    let outer = &unit.code().functions[0];
    let code = Compiler::default().function(bad.request(None), outer, Specialization::Call);
    let mut code = code.ok().unwrap();
    let symbol = SymbolRef::new(&StringRef::from_literal("Symbol.iterator"));
    let functions = &mut Rc::get_mut(&mut code).unwrap().functions;
    Rc::get_mut(functions).unwrap()[0].name = FunctionName::Owned(symbol.into());
    outer.set_code(Specialization::Call, Some(code));

    let mut encoder = Encoder::new(Hints {
        hot_functions: &[1],
        ..Hints::default()
    });
    let named = Output {
        strings: Some(&mut StringTableBuilder::default()),
        names: Some(OrderNames {
            entry: None,
            functions: &|_| Some(1),
        }),
        ..output(&mut encoder, ALL)
    };
    assert_eq!(bad.add_unit(named, &unit), Err(Unencodable));
    let has_error = Case::new(Goal::Script, "(");
    let result = has_error.add(output(&mut encoder, ALL), None);
    assert_eq!(result, Err(Unencodable));
    good.add(output(&mut encoder, ALL), None).unwrap();
    let linked = encoder.finish().unwrap();
    assert_eq!(linked.entries, [0]);
    assert_eq!(linked.named_hot_functions, 0);
    let digest = good.digest(&loader(), &intact(&linked.payload), 0);
    assert_eq!(
        digest,
        good.digest(&loader(), &intact(&good.encode(ALL)), 0)
    );
}

thread_local! {
    static ENTRIES: RefCell<Vec<(u32, bool)>> = const { RefCell::new(Vec::new()) };
    /// Where the records are, and what they are for.
    static FUNCTIONS: RefCell<Vec<(u32, Option<FunctionKey>)>> = const { RefCell::new(Vec::new()) };
    static STRINGS: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
}

struct Recorder;

impl Observer for Recorder {
    fn entry_read(&self, entry: EntryId, is_usable: bool) {
        ENTRIES.with_borrow_mut(|it| it.push((entry.offset, is_usable)));
    }

    fn function_read(&self, _: EntryId, key: Option<FunctionKey>, record: Range<u32>) {
        assert!(!record.is_empty());
        FUNCTIONS.with_borrow_mut(|it| it.push((record.start, key)));
    }

    fn shared_string_read(&self, text: Text<'_>) {
        STRINGS.with_borrow_mut(|it| it.push(order_hash(text)));
    }
}

fn observed(strings: &[u8]) -> Rc<Loader> {
    Rc::new(Loader::new(Some(&Embedding {
        strings: strings.to_vec().leak(),
        observer: Some(&Recorder),
        is_recorded: true,
    })))
}

fn key(start: u32, role: FunctionRole) -> Option<FunctionKey> {
    Some(FunctionKey { start, role })
}

#[test]
fn code_is_decoded_when_it_is_asked_for() {
    let source =
        "class A { static x = 1; y } class B { #m() {} } function f(a) { return a.property }";
    let case = Case::new(Goal::Script, source);
    let (mut strings, mut encoder) = (StringTableBuilder::default(), Encoder::default());
    let shared = Output {
        strings: Some(&mut strings),
        ..output(&mut encoder, ALL)
    };
    case.add(shared, None).unwrap();
    let payload = embedded(&encoder.finish().unwrap().payload);

    let loader = observed(&[1, 0, 0, 0, 0, 0, 0, 0]);
    assert!(case.load(&loader, &payload, 0).is_none());
    assert_eq!(ENTRIES.take(), [(0, false)]);
    let loader = observed(&strings.finish().unwrap());
    let loaded = case.load(&loader, &payload, 0).unwrap();
    assert_eq!(ENTRIES.take(), [(0, true)]);
    let property = order_hash(Text::from_ascii("property"));
    let reads = || STRINGS.with_borrow(|it| it.iter().filter(|&&it| it == property).count());
    assert_eq!(reads(), 0);

    case.digest(&loader, &intact(&case.encode(ALL)), 0).unwrap();
    assert!(ENTRIES.take().is_empty() && FUNCTIONS.take().is_empty());

    let f = &loaded.code().functions[0];
    assert!(f.code(Specialization::Call).is_none());
    let debugger = Instrumentation::DEBUGGER;
    assert!((f.load_code(Specialization::Call, debugger, &AnyName)).is_none());
    let first = case.code(f, Specialization::Call).unwrap();
    assert!(Rc::ptr_eq(&first, &f.code(Specialization::Call).unwrap()));
    assert!(case.code(f, Specialization::Construct).is_none());
    f.set_code(Specialization::Call, None);
    let again = case.code(f, Specialization::Call).unwrap();
    assert!(!Rc::ptr_eq(&first, &again));
    assert_eq!(
        first.body.instructions().as_ptr(),
        again.body.instructions().as_ptr()
    );
    assert_eq!(reads(), 1);

    FUNCTIONS.take();
    case.digest(&loader, &payload, 0).unwrap();
    let mut keys: Vec<_> = FUNCTIONS.take().iter().map(|it| it.1).collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            None,
            key(0, FunctionRole::DefaultConstructor),
            key(10, FunctionRole::FieldInitializer),
            key(24, FunctionRole::FieldInitializer),
            key(28, FunctionRole::DefaultConstructor),
            key(40, FunctionRole::Written),
            key(58, FunctionRole::Written),
        ]
    );
}

#[test]
fn records_go_where_the_hints_say() {
    let source =
        "function a() { return function b() { x.y } } function c() { return function d() { x.z } }
        function e() { x.w } x = () => { }";
    let starts = (0..).zip(source.bytes()).filter(|&(_, byte)| byte == b'(');
    let [a, b, c, d, e, unnamed] = starts.map(|it| it.0).collect::<Vec<u32>>()[..] else {
        unreachable!()
    };
    let case = Case::new(Goal::Script, source);
    let mut strings = StringTableBuilder::default();
    let mut encoder = Encoder::new(Hints {
        hot_functions: &[b, d, a, 999].map(u64::from),
        known_functions: &[u64::from(c)],
        loaded_entries: &[1, 3],
        unloaded_entries: &[2, 3],
    });
    for entry in [2, 1, 3] {
        let named = Output {
            strings: Some(&mut strings),
            names: Some(OrderNames {
                entry: Some(entry),
                functions: &|key| (key.start != unnamed).then_some(key.start.into()),
            }),
            ..output(&mut encoder, ALL)
        };
        case.add(named, None).unwrap();
    }
    let linked = encoder.finish().unwrap();
    let ends = linked.region_ends;
    assert!(ends.is_sorted() && ends[5] as usize == linked.payload.len());
    let region_of = |offset| ends.iter().position(|&end| offset < end).unwrap();
    let entries = linked.entries.iter().map(|&it| region_of(it));
    assert_eq!(entries.collect::<Vec<_>>(), [3, 0, 0]);
    assert_eq!(linked.named_hot_functions, 3);
    assert_eq!(linked.functions_without_name, 3);

    let loader = observed(&strings.finish().unwrap());
    let (payload, alone) = (embedded(&linked.payload), intact(&case.encode(ALL)));
    let early = [(1, b), (1, a), (2, e), (2, unnamed), (4, c), (4, d)];
    let late = [(4, a), (4, b), (4, c), (4, d), (4, e), (4, unnamed)];
    for (&entry, expected) in linked.entries.iter().zip([late, early, early]) {
        let digest = case.digest(&loader, &payload, entry);
        assert!(digest.is_some() && digest == case.digest(&loader, &alone, 0));
        let mut records = FUNCTIONS.take();
        records.sort();
        let placed = (records.iter()).map(|&(at, key)| (region_of(at), key.unwrap().start));
        assert_eq!(placed.collect::<Vec<_>>(), expected);
    }
}

#[test]
fn what_cannot_have_a_name_goes_with_its_class() {
    let case = Case::new(Goal::Script, "class A { #m() {} }");
    let mut encoder = Encoder::new(Hints {
        hot_functions: &[1],
        known_functions: &[2],
        ..Hints::default()
    });
    let named = Output {
        names: Some(OrderNames {
            entry: None,
            functions: &|_| Some(2),
        }),
        ..output(&mut encoder, ALL)
    };
    case.add(named, None).unwrap();
    let linked = encoder.finish().unwrap();
    let [entries, hot, unknown, ..] = linked.region_ends;
    assert!(entries < hot && hot == unknown && linked.functions_without_name == 0);
}

#[test]
fn layout_of_a_payload_with_its_own_strings() {
    let link = |source, times| {
        let (case, mut encoder) = (Case::new(Goal::Script, source), Encoder::default());
        for _ in 0..times {
            case.add(output(&mut encoder, ALL), None).unwrap();
        }
        let linked = encoder.finish().unwrap();
        let [.., cold, positions] = linked.region_ends;
        (linked.payload[..cold as usize].to_vec(), positions - cold)
    };
    let source = "x = [() => { y = () => a.one; a.two }, () => a.three]";
    assert!(link(source, 1).0.ends_with(b"xyatwoonethree"));
    assert_eq!(link(source, 2).1, link(source, 1).1);
}

#[test]
fn hot_strings_come_first() {
    let case = Case::new(Goal::Script, "cold.two.one['日']");
    let hot = ["one", "one", "missing", "two"].map(|it| order_hash(Text::from_ascii(it)));
    let (mut strings, mut encoder) = (StringTableBuilder::new(&hot), Encoder::default());
    let shared = Output {
        strings: Some(&mut strings),
        ..output(&mut encoder, ALL)
    };
    case.add(shared, None).unwrap();
    let strings = strings.finish().unwrap();
    assert!(strings.ends_with(b"onetwocold\xe5\x65"));
    let payload = embedded(&encoder.finish().unwrap().payload);
    let loaded = case.load(&observed(&strings), &payload, 0).unwrap();
    assert_eq!(case.describe(&loaded), case.describe(&case.compile()));
}

#[test]
fn what_an_order_file_calls_a_string() {
    assert_eq!(order_hash(Text::EMPTY), 0xefd0_1f60_ba99_2926);
    let wide = Text::Utf16(&[0x61, 0xe9]);
    assert_eq!(order_hash(wide), order_hash(Text::Latin1(b"a\xe9")));
}

#[test]
fn lines_and_long_strings() {
    let line_starts = |source: &str| {
        let case = Case::new(Goal::Script, source);
        let bytes = case.encode(0);
        assert!(bytes.len() < 200);
        let loaded = loader().script(&intact(&bytes), 0, &case.key(), &AnyName, None);
        let lines = loaded.unwrap().lines?;
        let lines = lines.table().unwrap();
        let starts = (0..).map_while(|line| Some(lines.range_of(case.source.text(), line)?.start));
        Some(starts.collect::<Vec<_>>())
    };
    let long = "p".repeat(2000);
    let starts = line_starts(&format!("1\r\n\n2\r'{long}'\n"));
    assert_eq!(starts.unwrap(), [0, 3, 4, 6, 2009]);
    assert_eq!(line_starts("1\n2"), None);

    let case = Case::new(Goal::Script, &format!("1\n'{long}'"));
    let bytes = case.encode(0);
    for end in 0..bytes.len() {
        let loaded = loader().script(&intact(&bytes[..end]), 0, &case.key(), &AnyName, None);
        let lines = loaded.and_then(|it| it.lines);
        assert!(lines.is_none_or(|it| it.table().is_some()));
    }
}

#[test]
fn deeply_nested_functions() {
    const DEPTH: usize = 200;
    let source = ["()=>".repeat(DEPTH), "0".into()].concat();
    let case = Case::new(Goal::Script, &source);
    let digest = case.digest(&loader(), &intact(&case.encode(ALL)), 0);
    assert_eq!(digest.unwrap().records as usize, DEPTH + 1);
}

#[test]
fn functions_end_at_the_depth_that_is_asked_for() {
    let case = Case::new(Goal::Script, "(function () { (function () {})() })()");
    for depth in 0..3 {
        let digest = case.digest(&loader(), &intact(&case.encode(depth)), 0);
        assert_eq!(digest.unwrap().records, depth + 1);
    }
}
