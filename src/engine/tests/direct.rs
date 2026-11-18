//! Every form in the table is called through its entry and compared with the function that it stands for.

use core::fmt::Write;

use bun_engine_bytecode::Specialization;
use bun_engine_number::Random;
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, SharedString, StringRef, Text, names};
use bun_engine_vm::direct::{Constant, Form, Reach, State, forms_for, intrinsic_of};
use bun_engine_vm::heap::HeapKind;
use bun_engine_vm::*;

const HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: || StringRef::from_literal("en-US"),
    derive_shadow_realm: |cx| Ok(cx.global()),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};
static ENGLISH: RealmHooks = HOOKS;
static THAI: RealmHooks = RealmHooks {
    default_language: || StringRef::from_literal("th"),
    ..HOOKS
};

const MAX_ARGUMENTS: usize = 8;

const NUMBERS: [f64; 46] = [
    0.0,
    1.0,
    2.0,
    3.0,
    4.0,
    7.0,
    10.0,
    16.0,
    21.0,
    36.0,
    37.0,
    64.0,
    99.0,
    100.0,
    101.0,
    255.0,
    256.0,
    1000.0,
    1001.0,
    2024.0,
    65536.0,
    128_512.0,
    1_114_112.0,
    -1.0,
    -2.0,
    -100.0,
    2_147_483_647.0,
    -2_147_483_648.0,
    -0.0,
    0.5,
    -0.5,
    0.499_999_999_999_999_94,
    1.5,
    -2.5,
    1e-7,
    123.456,
    2_147_483_648.0,
    4_294_967_297.0,
    -2_251_799_813_685_248.0,
    9_007_199_254_740_992.0,
    8.64e15,
    1e21,
    f64::MAX,
    f64::INFINITY,
    f64::NEG_INFINITY,
    f64::NAN,
];

const TEXTS: [&str; 52] = [
    "",
    "a",
    "b",
    "c",
    ",",
    " ",
    "é",
    "日",
    "ab",
    "bc",
    "abc",
    "abcabc",
    "ABC abc",
    "a,b,,c",
    " \t a b\n",
    "\u{a0}a\u{feff}",
    "äz",
    "z",
    "éßÿµ",
    "İıΣ ΑΣ",
    "e\u{301}ﬁ",
    "a日本b",
    "😀",
    "a😀b😀",
    "12",
    "-0",
    "007",
    "0x1F",
    " +1.5e3z",
    "1e1000",
    "-Infinity",
    "123456789012345678901234567890",
    "$&$&",
    "[$1|$`|$']",
    "$<first>$$",
    "g",
    "gg",
    "iu",
    "(",
    "a|b",
    "%41%2f%E6%97%A5",
    "%E0%A4%A",
    "%u65E5%e9",
    "a b&c/d?é",
    "{\"a\":[1,-0,\"é\"],\"__proto__\":{},\"0\":null}",
    "[1,",
    "\"\\u2028\"",
    "2024-03-10T02:30:00",
    "2024-02-30",
    "Tue, 01 Feb 2022 13:05:09 GMT",
    "NFKD",
    "length",
];

#[derive(Clone, Copy, PartialEq, Debug)]
enum Layout {
    Flat,
    Wide,
    Atom,
    Substring,
    SubstringOfWide,
    Rope,
    /// After 300 other characters, so that it is searched without being put together.
    EndOfLongRope,
    WithoutLastUnit,
}

const LAYOUTS: [Layout; 8] = [
    Layout::Flat,
    Layout::Wide,
    Layout::Atom,
    Layout::Substring,
    Layout::SubstringOfWide,
    Layout::Rope,
    Layout::EndOfLongRope,
    Layout::WithoutLastUnit,
];

#[derive(Clone, Copy, Debug)]
enum Recipe {
    Immediate(u64),
    String(&'static str, Layout),
    Made { realm: usize, index: u64 },
}

impl Recipe {
    /// Among those that often occur in each other, or are positions in them.
    fn is_related(self) -> bool {
        match self {
            // SAFETY: no cell.
            Recipe::Immediate(bits) => (unsafe { Value::from_bits(bits) }.as_number())
                .is_none_or(|it| it.abs() < 8.0 || !it.is_finite()),
            Recipe::String(text, _) => text.bytes().all(|it| matches!(it, b'a'..=b'c' | b',')),
            Recipe::Made { .. } => true,
        }
    }
}

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn narrow(cx: &Cx, units: &[u16]) -> Gc<JsString> {
    JsString::new(cx, StringRef::try_narrowed(Text::Utf16(units)).unwrap())
}

fn make_string(cx: &Cx, text: &str, layout: Layout) -> Gc<JsString> {
    let all = units(text);
    let inside = |around: &str| {
        let (around, length) = (units(around), all.len() as u32);
        let base = narrow(cx, &[&around[..], &all, &around].concat());
        base.substring(cx, 1, 1 + length).unwrap()
    };
    let (first, second) = all.split_at(all.len() / 2);
    match layout {
        Layout::Flat => narrow(cx, &all),
        Layout::Wide => JsString::new(cx, StringRef::try_from_units(&all).unwrap()),
        Layout::Atom => JsString::try_from_text_as_atom(cx, Text::Utf16(&all)).unwrap(),
        Layout::Substring => inside("a"),
        Layout::SubstringOfWide => inside("日"),
        Layout::Rope => JsString::concat(cx, narrow(cx, first), narrow(cx, second)).unwrap(),
        Layout::EndOfLongRope => {
            let start = narrow(cx, &[u16::from(b'-'); 300]);
            JsString::concat3(cx, start, narrow(cx, first), narrow(cx, second)).unwrap()
        }
        Layout::WithoutLastUnit => narrow(cx, &all[..all.len().saturating_sub(1)]),
    }
}

fn run(cx: &mut Cx, source: &str) -> Value {
    let provider = SourceProvider::build(StringRef::from_str(source), None, SourceType::Program);
    let source = SourceCode::whole(provider.finish());
    evaluate_script(cx, &source, Value::UNDEFINED).unwrap()
}

fn get(cx: &mut Cx, object: Value, name: &'static str) -> Value {
    (object.get(cx, Identifier::from_literal(name).name())).unwrap()
}

#[derive(Clone, Copy)]
struct Realm {
    global: Gc<GlobalObject>,
    makers: Gc<JsObject>,
    functions: Value,
    take_log: Value,
    unwanted: Value,
}

impl Realm {
    fn new(cx: &mut Cx, hooks: &'static RealmHooks) -> Realm {
        let global = GlobalObject::create(cx, hooks);
        let cx = cx.in_realm(global);
        let parts = run(cx, include_str!("direct.js"));
        Realm {
            global,
            makers: get(cx, parts, "makers").cast(),
            functions: get(cx, parts, "functions"),
            take_log: get(cx, parts, "takeLog"),
            unwanted: get(cx, parts, "unwanted"),
        }
    }
}

fn asks_for_long_string(form: Form, recipe: Recipe) -> bool {
    use Form::*;
    let longest = Value::int32(300).to_bits();
    let has_length = [
        repeat,
        pad_start,
        pad_start_with_spaces,
        pad_end,
        pad_end_with_spaces,
    ];
    has_length.contains(&form)
        && matches!(recipe, Recipe::Immediate(bits) if bits > longest && bits as i32 > 0)
}

/// A form, and a call that it suits.
#[derive(Clone, Copy)]
struct Case {
    form: Form,
    callee: Value,
    specialization: Specialization,
    argument_count: usize,
}

fn cases(cx: &mut Cx, realm: Realm) -> RootVec<Case> {
    let cx = cx.in_realm(realm.global);
    let public = cx.call(realm.functions, Value::UNDEFINED, &[]).unwrap();
    let mut callees = ValueVec::new();
    for index in 0..public.cast::<JsArray>().length() {
        callees.push(public.get_index(cx, index).unwrap());
    }
    callees.push(cx.private_min().into());
    callees.push(cx.private_to_length().into());
    callees.push(cx.private_to_integer_or_infinity().into());
    let mut cases = root_vec();
    for &callee in callees.iter() {
        let intrinsic = intrinsic_of(&callee.cast::<JsObject>());
        for specialization in [Specialization::Call, Specialization::Construct] {
            for argument_count in 0..=MAX_ARGUMENTS {
                let forms = forms_for(intrinsic, specialization, argument_count);
                let wanted = forms.filter(|it| argument_count <= it.arguments().len() + 1);
                cases.extend(wanted.map(|form| Case {
                    form,
                    callee,
                    specialization,
                    argument_count,
                }));
            }
        }
    }
    cases
}

struct Call {
    this: Value,
    arguments: ValueVec,
}

impl Call {
    fn operands(&self) -> impl Iterator<Item = Value> {
        core::iter::once(self.this).chain(self.arguments.iter().copied())
    }

    /// With the matchers of iterators.
    fn all<T: CellKind>(&self) -> impl Iterator<Item = Gc<T>> {
        // SAFETY: a field of a live cell.
        let matcher = |it: Gc<RegExpStringIterator>| unsafe {
            *(it.as_ptr())
                .byte_add(RegExpStringIterator::OFFSET_OF_MATCHER)
                .cast::<Value>()
        };
        let matchers = self.operands().filter_map(Value::downcast).map(matcher);
        self.operands().chain(matchers).filter_map(Value::downcast)
    }

    fn fibers(&self) -> Vec<usize> {
        // SAFETY: a field of a live cell.
        let fiber = |it: Gc<JsString>| unsafe {
            *it.as_ptr()
                .byte_add(JsString::OFFSET_OF_FIBER)
                .cast::<usize>()
        };
        self.all().map(fiber).collect()
    }
}

/// The callees are of the first realm.
struct World {
    realms: [Realm; 2],
    recipes: Vec<(Recipe, SpeculatedType)>,
    recorded: Gc<RegExpObject>,
}

impl World {
    fn new(cx: &mut Cx, hooks: &'static RealmHooks) -> World {
        let realms = [Realm::new(cx, hooks), Realm::new(cx, hooks)];
        let recorded = run(cx.in_realm(realms[1].global), "/(q)(r)?/").cast();
        let mut world = World {
            realms,
            recipes: Vec::new(),
            recorded,
        };
        let others = [Value::UNDEFINED, Value::NULL, Value::TRUE, Value::FALSE];
        let numbers = NUMBERS.map(Value::number).into_iter();
        let immediates = numbers.chain([Value::double(2.0)]).chain(others);
        let immediates = immediates.map(|it| Recipe::Immediate(it.to_bits()));
        let strings = LAYOUTS.map(|layout| TEXTS.map(|text| Recipe::String(text, layout)));
        let count = realms[0].makers.cast::<JsArray>().length().into();
        let made = |realm| move |index| Recipe::Made { realm, index };
        let recipes = (immediates.chain(strings.into_iter().flatten()))
            .chain((0..count).map(made(0)))
            .chain((0..count).step_by(3).map(made(1)));
        let typed = |recipe| (recipe, SpeculatedType::of(Some(world.make(cx, recipe))));
        world.recipes = recipes.map(typed).collect();
        world
    }

    fn cx<'a>(&self, cx: &'a mut Cx) -> &'a mut Cx {
        cx.in_realm(self.realms[0].global)
    }

    fn make(&self, cx: &mut Cx, recipe: Recipe) -> Value {
        match recipe {
            // SAFETY: no cell.
            Recipe::Immediate(bits) => unsafe { Value::from_bits(bits) },
            Recipe::String(text, layout) => make_string(cx, text, layout).into(),
            Recipe::Made { realm, index } => {
                let maker = self.realms[realm].makers.get_index(cx, index).unwrap();
                let made = cx.call(maker, Value::UNDEFINED, &[]);
                made.unwrap_or_else(|thrown| cx.catch_value(thrown).unwrap())
            }
        }
    }

    /// Operands that have the types of those of the form, as far as the call has them.
    fn samples(&self, case: Case) -> impl Iterator<Item = Vec<Recipe>> + use<> {
        let count = usize::from(case.form.takes_this) + case.argument_count;
        let candidates: Vec<Vec<Recipe>> = (case.form.operands.iter().take(count))
            .map(|operand| {
                let suits = |&&(recipe, ty): &&(Recipe, SpeculatedType)| {
                    operand.kind.types().contains(ty) && !asks_for_long_string(case.form, recipe)
                };
                self.recipes.iter().filter(suits).map(|it| it.0).collect()
            })
            .collect();
        let mut random = Random::new(case.form as u32 * 16 + case.argument_count as u32);
        core::iter::repeat_with(move || {
            let attempts = if random.next_u32() & 1 == 0 { 1 } else { 20 };
            let pick = |all: &Vec<Recipe>| {
                let mut any = || all[random.next_u32() as usize % all.len()];
                let related = (1..attempts).map(|_| any()).find(|it| it.is_related());
                related.unwrap_or_else(any)
            };
            candidates.iter().map(pick).collect()
        })
    }

    /// From a state that is the same each time.
    fn prepare(&self, cx: &mut Cx, case: Case, recipes: &[Recipe]) -> Call {
        let mut values = recipes.iter().map(|&recipe| self.make(cx, recipe));
        let this = match case.form.takes_this {
            true => values.next().unwrap(),
            false => Value::UNDEFINED,
        };
        let mut arguments = ValueVec::new();
        values.for_each(|value| arguments.push(value));
        while arguments.len() < case.argument_count {
            arguments.push(self.realms[0].unwanted);
        }
        for realm in self.realms {
            realm.global.random_state().set(Random::new(1));
            realm.global.overridden_date_now().set(1_700_000_000_123.0);
            self.record_match(cx.in_realm(realm.global), "pqs");
            cx.call(realm.take_log, Value::UNDEFINED, &[]).unwrap();
        }
        Call { this, arguments }
    }

    fn record_match(&self, cx: &mut Cx, subject: &'static str) {
        let subject = JsString::from_literal(cx, subject);
        assert!(self.recorded.test(cx, subject).unwrap());
    }

    fn describe(&self, cx: &mut Cx, call: &Call, value: Value, out: &mut String) {
        let Some(object) = value.as_object() else {
            return describe_primitive(cx, value, out);
        };
        if let Some(position) = call.operands().position(|it| it == value) {
            return write!(out, "operand {position}").unwrap();
        }
        let realm = (self.realms.iter()).position(|it| Some(it.global) == object.realm());
        let prototype = object.prototype_direct().as_cell();
        let is_prototype = |&slot: &RealmSlot| {
            let global = object.realm().filter(|_| prototype.is_some());
            global.is_some_and(|it| it.slot_if_initialized(slot) == prototype)
        };
        let prototype = RealmSlot::ALL.into_iter().find(is_prototype);
        let class = object.class().name();
        write!(out, "{class} of {realm:?} from {prototype:?} {{").unwrap();
        if object.is::<ErrorInstance>() {
            let message = object.get(cx, names::message).unwrap();
            return describe_primitive(cx, message, out);
        }
        if object.is_callable() {
            return;
        }
        describe_fields(cx, value, out);
        if let Some(iterator) = value.downcast::<RegExpStringIterator>() {
            while let Ok(Some(next)) = iterator.next_match(cx).map_err(|it| cx.catch(it)) {
                self.describe(cx, call, next.into(), out);
            }
        }
        let (kinds, mode) = (PropertyNameMode::StringsAndSymbols, DontEnumMode::Include);
        for key in object.own_keys(cx, kinds, mode).unwrap().iter() {
            let property = object.get_own_property_descriptor(cx, key.name());
            let property = property.unwrap().unwrap();
            write!(out, "{key}/{:x}:", property.attributes().bits()).unwrap();
            self.describe(cx, call, property.value().unwrap_or_default(), out);
        }
        out.push('}');
    }

    fn describe_result(&self, cx: &mut Cx, call: &Call, result: JsResult<Value>) -> String {
        let mut out = String::new();
        let value = result.unwrap_or_else(|thrown| {
            out.push_str("throws ");
            cx.catch_value(thrown).unwrap()
        });
        for realm in self.realms {
            let log = cx.call(realm.take_log, Value::UNDEFINED, &[]).unwrap();
            describe_primitive(cx, log, &mut out);
        }
        self.describe(cx, call, value, &mut out);
        out
    }

    /// For each part of the `State` that a call could change.
    fn observe(&self, cx: &mut Cx, call: &Call) -> [(State, String); 6] {
        let mut parts = [
            State::LAST_INDEX,
            State::PATTERN,
            State::LAST_MATCH,
            State::DATE,
            State::RANDOM,
            State::ITERATOR,
        ]
        .map(|part| (part, String::new()));
        let [last_index, pattern, last_match, date, random, iterator] = parts.each_mut();
        for regexp in call.all::<RegExpObject>() {
            self.describe(cx, call, regexp.last_index(), &mut last_index.1);
            write!(pattern.1, "{}", regexp.regexp().to_literal_text()).unwrap();
        }
        for it in call.all::<DateInstance>() {
            describe_fields(cx, it.into(), &mut date.1);
        }
        for it in call.all::<JsStringIterator>() {
            describe_fields(cx, it.into(), &mut iterator.1);
        }
        for it in call.all::<RegExpStringIterator>() {
            // SAFETY: a field of a live cell.
            let is_done = unsafe {
                *(it.as_ptr())
                    .byte_add(RegExpStringIterator::OFFSET_OF_IS_DONE)
                    .cast::<bool>()
            };
            write!(iterator.1, "{is_done}").unwrap();
        }
        for realm in self.realms {
            let cx = cx.in_realm(realm.global);
            for part in [
                Ok(cx.regexp_input()),
                cx.regexp_last_match(),
                cx.regexp_left_context(),
                cx.regexp_last_group(1),
                cx.regexp_last_paren(),
            ] {
                describe_primitive(cx, part.unwrap().into(), &mut last_match.1);
            }
            let next = realm.global.random_state().get().next_u64();
            write!(random.1, "{next} ").unwrap();
        }
        parts
    }

    fn change(&self, cx: &mut Cx, call: &Call, part: State) {
        let global = cx.global();
        for regexp in call.all::<RegExpObject>() {
            let cx = cx.in_realm_of(&regexp);
            let last_index = regexp.last_index();
            if part == State::PATTERN {
                let other =
                    RegExp::create(cx, &StringRef::from_literal("c"), regexp.regexp().flags());
                let _ = (regexp.recompile(cx, other.unwrap())).map_err(|it| cx.catch(it));
                regexp.set(cx, names::lastIndex, last_index, false).unwrap();
            } else if part == State::LAST_INDEX {
                regexp.set(cx, names::lastIndex, 2.into(), false).unwrap();
            }
        }
        match part {
            State::SHAPE => (call.all::<JsObject>()).for_each(|it| {
                it.put_direct(cx, names::toString, Value::NULL, Attributes::NONE);
            }),
            State::LAST_MATCH => self.record_match(cx, "qr"),
            State::DATE => (call.all::<DateInstance>()).for_each(|it| _ = it.set_time(1e12)),
            State::CLOCK => global.overridden_date_now().set(5.0),
            State::RANDOM => global.random_state().set(Random::new(2)),
            State::ITERATOR => {
                (call.all::<JsStringIterator>()).for_each(|it| _ = it.next(cx).unwrap());
                for it in call.all::<RegExpStringIterator>() {
                    let _ = it.next_match(cx).map_err(|it| cx.catch(it));
                }
            }
            _ => {}
        }
    }

    /// Calls `visit` for up to `limit` samples until it has returned true that often.
    fn for_samples(
        &self,
        case: Case,
        limit: usize,
        mut visit: impl FnMut(&[Recipe]) -> bool,
    ) -> usize {
        const ATTEMPTS: usize = 40;
        let samples = self.samples(case).take(limit * ATTEMPTS);
        samples.filter(|it| visit(it)).take(limit).count()
    }

    /// False if the form does not take these operands.
    fn compare(&self, cx: &mut Cx, case: Case, recipes: &[Recipe], stress_period: u32) -> bool {
        let (cx, form) = (self.cx(cx), case.form);
        let call = self.prepare(cx, case, recipes);
        let (before, fibers) = (self.observe(cx, &call), call.fibers());
        cx.heap
            .set_stress_period(stress_period, recipes.len() as u32);
        let result = form.call(cx, call.this, &call.arguments);
        cx.heap.set_stress_period(0, 0);
        let Some(result) = result else {
            return false;
        };
        for (old, new) in fibers.into_iter().zip(call.fibers()) {
            let may_change = form.resolves_ropes && old & JsString::IS_ROPE != 0;
            assert!(old == new || may_change, "{form:?} {recipes:?}");
        }
        let after = self.observe(cx, &call);
        for ((part, old), (_, new)) in before.iter().zip(&after) {
            let holds = old == new || form.writes.contains(*part);
            assert!(holds, "{form:?} {recipes:?} writes {part:?}");
        }
        if let Ok(value) = result {
            assert_has_declared_type(form, value);
        }
        let result = self.describe_result(cx, &call, result);

        let call = self.prepare(cx, case, recipes);
        let expected = match case.specialization {
            Specialization::Call => cx.call(case.callee, call.this, &call.arguments),
            Specialization::Construct => {
                (cx.construct(case.callee, &call.arguments, case.callee)).map(Into::into)
            }
        };
        assert_eq!(after, self.observe(cx, &call), "{form:?} {recipes:?}");
        let expected = self.describe_result(cx, &call, expected);
        assert_eq!(result, expected, "{form:?} {recipes:?}");
        true
    }

    /// What the form gives after `change`.
    fn result(
        &self,
        cx: &mut Cx,
        case: Case,
        recipes: &[Recipe],
        change: impl FnOnce(&mut Cx, &Call),
    ) -> Option<String> {
        let cx = self.cx(cx);
        let call = self.prepare(cx, case, recipes);
        change(cx, &call);
        for realm in self.realms {
            cx.call(realm.take_log, Value::UNDEFINED, &[]).unwrap();
        }
        let result = case.form.call(cx, call.this, &call.arguments)?;
        Some(self.describe_result(cx, &call, result))
    }
}

fn assert_has_declared_type(form: Form, value: Value) {
    let holds = form
        .result_types()
        .contains(SpeculatedType::of(Some(value)));
    assert!(holds, "{form:?} gives {value:?}");
}

fn describe_primitive(cx: &Cx, value: Value, out: &mut String) {
    if let Some(string) = value.as_string() {
        let text = string.to_string_without_resolving();
        match text.len() {
            0..1000 => write!(out, "{:x?}", text.text().code_units().collect::<Vec<_>>()),
            length => write!(out, "{length} units, {:x}", text.hash()),
        }
    } else if let Some(symbol) = value.as_symbol() {
        let is_registered = symbol.symbol().flags().is_registered();
        write!(
            out,
            "{} {is_registered}",
            symbol.descriptive_string().unwrap()
        )
    } else if let Some(bigint) = value.as_bigint() {
        write!(out, "{}n", bigint.to_string_ref(cx, 16).unwrap())
    } else {
        write!(out, "{value:?}")
    }
    .unwrap();
    out.push(' ');
}

fn describe_fields(cx: &Cx, value: Value, out: &mut String) {
    if let Some(date) = value.downcast::<DateInstance>() {
        let cached = (date.local_fields(cx), date.utc_fields(cx));
        let (dates, time) = (cx.date_cache(), date.time());
        assert_eq!(cached, (dates.local_fields(time), dates.utc_fields(time)));
        write!(out, "{time}").unwrap();
    } else if let Some(regexp) = value.downcast::<RegExpObject>() {
        let (text, is_legacy) = (
            regexp.regexp().to_literal_text(),
            regexp.has_legacy_features(),
        );
        write!(out, "{text} {is_legacy}").unwrap();
    } else if let Some(iterator) = value.downcast::<JsStringIterator>() {
        let copy = iterator.duplicate(cx);
        while let Some(next) = copy.next(cx).unwrap() {
            describe_primitive(cx, next.into(), out);
        }
    }
}

/// Inside a call, so that the time zone stays what it is while another test changes that of the process.
fn inside_call(body: fn(&mut Cx)) {
    let mut options = Options::default();
    options.collect_every_n_allocations = u32::MAX;
    set_options(options);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &ENGLISH)) };
    let function = JsNativeClosure::create(cx, 0, &StringRef::empty(), &[], move |cx, _, _| {
        body(cx);
        Ok(Value::UNDEFINED)
    });
    cx.call(function.into(), Value::UNDEFINED, &[]).unwrap();
}

fn compare_all(cx: &mut Cx, samples: usize, stress_period: u32) {
    let world = World::new(cx, &ENGLISH);
    let mut untried = Form::ALL.to_vec();
    for &case in &cases(cx, world.realms[0]) {
        let compare = |recipes: &[Recipe]| world.compare(cx, case, recipes, stress_period);
        let count = world.for_samples(case, samples, compare);
        assert!(count != 0, "nothing suits {:?}", case.form);
        untried.retain(|&form| form != case.form);
    }
    assert_eq!(untried, []);
}

#[test]
fn forms_do_what_the_functions_do() {
    inside_call(|cx| compare_all(cx, 600, 0));
}

#[test]
fn forms_survive_a_collection_at_every_allocation() {
    inside_call(|cx| compare_all(cx, 30, 1));
}

#[test]
fn forms_that_still_apply_follow_changes_to_the_library() {
    const CHANGES: [&str; 15] = [
        "RegExp.prototype.exec = () => null",
        "Object.defineProperty(RegExp.prototype, 'flags', { value: 'y' })",
        "Object.defineProperty(RegExp.prototype, 'global', { value: true })",
        "Object.defineProperty(RegExp.prototype, 'unicode', { value: true })",
        "for (const it of ['match', 'matchAll', 'replace', 'search', 'split']) RegExp.prototype[Symbol[it]] = () => it",
        "for (const it of ['match', 'matchAll', 'replace', 'search', 'split']) String.prototype[Symbol[it]] = () => it",
        "Object.defineProperty(RegExp.prototype, Symbol.match, { get() { throw 0 } })",
        "Object.defineProperty(RegExp, Symbol.species, { value: function () { return /c/y } })",
        "RegExp.prototype.constructor = { [Symbol.species]: function () { return /c/y } }",
        "String.prototype.toString = () => 'other'",
        "Object.prototype[Symbol.toPrimitive] = () => 'other'",
        "Object.prototype.toJSON = () => 'other'",
        "Date.prototype.toISOString = () => 'other'",
        "Date.prototype.valueOf = () => NaN",
        "Object.defineProperty(Object.prototype, 0, { set() { throw 0 }, get: () => 'other' })",
    ];
    inside_call(|cx| {
        for change in CHANGES {
            let world = World::new(cx, &ENGLISH);
            let cases = cases(cx, world.realms[0]);
            for case in &cases {
                case.form.prepare(cx, &world.realms[0].global);
            }
            run(world.cx(cx), change);
            for &case in &cases {
                let attempts = world.samples(case).take(30);
                attempts.for_each(|recipes| _ = world.compare(cx, case, &recipes, 0));
            }
        }
    });
}

#[test]
fn results_depend_only_on_what_is_read() {
    inside_call(|cx| {
        let (world, thai) = (World::new(cx, &ENGLISH), World::new(cx, &THAI));
        for &case in &cases(cx, world.realms[0]) {
            let form = case.form;
            world.for_samples(case, 60, |recipes| {
                assert!(cx.set_time_zone(Text::from_ascii("America/New_York")));
                let Some(expected) = world.result(cx, case, recipes, |_, _| {}) else {
                    return false;
                };
                for part in (!form.reads).iter() {
                    let result = match part {
                        State::LOCALE => thai.result(cx, case, recipes, |_, _| {}),
                        State::TIME_ZONE => world.result(cx, case, recipes, |cx, _| {
                            assert!(cx.set_time_zone(Text::from_ascii("Asia/Kolkata")));
                        }),
                        _ => {
                            world.result(cx, case, recipes, |cx, call| world.change(cx, call, part))
                        }
                    };
                    let holds = result.is_some_and(|it| it == expected);
                    assert!(holds, "{form:?} {recipes:?} reads {part:?}");
                    assert!(cx.set_time_zone(Text::from_ascii("America/New_York")));
                }
                true
            });
        }
    });
}

#[test]
fn objects_are_new_and_realms_matter_where_that_is_declared() {
    inside_call(|cx| {
        let world = World::new(cx, &ENGLISH);
        for &case in &cases(cx, world.realms[0]) {
            let form = case.form;
            world.for_samples(case, 20, |recipes| {
                let cx = world.cx(cx);
                let call = world.prepare(cx, case, recipes);
                let once = || match form.call(cx, call.this, &call.arguments)? {
                    Ok(value) => Some(value),
                    Err(thrown) => cx.catch(thrown).ok().and(None),
                };
                let (Some(first), Some(second)) = (once(), once()) else {
                    return false;
                };
                let is_same = first.same_value(cx, second).unwrap();
                let has_identity = first.is_object() || first.is_symbol();
                assert!(is_same || !form.is_pure(), "{form:?} {recipes:?}");
                assert!(!is_same || !has_identity || !form.is_distinct);
                if form.suits_any_realm() {
                    let here = world.result(cx, case, recipes, |_, _| {});
                    let call = world.prepare(cx, case, recipes);
                    let cx = cx.in_realm(world.realms[1].global);
                    let there = form.call(cx, call.this, &call.arguments);
                    let there = there.map(|it| world.describe_result(cx, &call, it));
                    assert_eq!(here, there, "{form:?} {recipes:?}");
                }
                true
            });
        }
    });
}

#[test]
fn a_prepared_form_leaves_the_shapes_of_a_new_realm_alone() {
    fn shapes(cx: &Cx) -> Vec<(usize, ShapeId)> {
        let mut shapes = Vec::new();
        (cx.heap).for_each_live_cell(|cell| shapes.push((cell.address(), cell.shape_id())));
        shapes.sort_unstable_by_key(|it| it.0);
        shapes
    }
    inside_call(|cx| {
        let mut world = World::new(cx, &ENGLISH);
        let cases = cases(cx, world.realms[0]);
        let mut tried = Vec::new();
        for &case in cases.iter().filter(|it| it.form.reach == Reach::Allocates) {
            if tried.contains(&case.form) {
                continue;
            }
            tried.push(case.form);
            world.realms[0] = Realm::new(cx, &ENGLISH);
            cx.heap.collect_and_sweep(None);
            world.for_samples(case, 4, |recipes| {
                let cx = world.cx(cx);
                let call = world.prepare(cx, case, recipes);
                assert!(case.form.prepare(cx, &cx.global()));
                cx.heap.begin_deferral();
                let before = shapes(cx);
                let result = case.form.call(cx, call.this, &call.arguments);
                let after = shapes(cx);
                // SAFETY: begun above.
                unsafe { cx.heap.end_deferral() };
                match result {
                    Some(Ok(_)) => {
                        let mut rest = after.iter();
                        let holds = before.iter().all(|old| rest.any(|new| new == old));
                        assert!(holds, "{:?} {recipes:?}", case.form);
                        true
                    }
                    Some(Err(thrown)) => cx.catch(thrown).is_err(),
                    None => false,
                }
            });
        }
    });
}

#[test]
fn what_is_found_ahead_of_time_is_what_the_call_gives() {
    enum Known {
        Immediate(u64),
        String(SharedString),
    }
    inside_call(|cx| {
        let world = World::new(cx, &ENGLISH);
        let mut jobs = Vec::new();
        for &case in &cases(cx, world.realms[0]) {
            let form = case.form;
            world.for_samples(case, 30, |recipes| {
                let Some(expected) = world.result(cx, case, recipes, |_, _| {}) else {
                    return false;
                };
                let cx = world.cx(cx);
                let call = world.prepare(cx, case, recipes);
                let Some(value) = form.evaluate(cx, call.this, &call.arguments) else {
                    return true;
                };
                assert_has_declared_type(form, value);
                assert_eq!(world.describe_result(cx, &call, Ok(value)), expected);
                let known = |it: Value| match it.as_string() {
                    Some(it) => Some(Known::String(StringRef::to_shared(&*it.try_resolved()?))),
                    None => (!it.is_cell()).then(|| Known::Immediate(it.to_bits())),
                };
                let operands = call.operands().skip(usize::from(!form.takes_this));
                let operands = operands.take(form.operands.len()).map(known);
                if let Some(operands) = operands.collect::<Option<Vec<_>>>() {
                    jobs.push((form, operands, value.to_bits()));
                }
                true
            });
        }
        let fold_all = move || {
            let mut folded = Vec::new();
            for (form, operands, expected) in &jobs {
                let constant = |it| match it {
                    &Known::Immediate(bits) => Constant::Immediate(bits),
                    Known::String(string) => Constant::String(string),
                };
                let operands: Vec<_> = operands.iter().map(constant).collect();
                if let Some(result) = form.fold(&operands) {
                    assert_eq!(result, *expected, "{form:?}");
                    folded.push(*form);
                }
            }
            folded
        };
        let thread = std::thread::Builder::new().spawn(fold_all).unwrap();
        let folded = thread.join().unwrap();
        for form in [Form::sin, Form::index_of_in_characters, Form::true_of_int32] {
            assert!(folded.contains(&form));
        }
    });
}
