use bun_engine_bytecode::{FunctionKind, Visibility};
use bun_engine_standalone as _;
use bun_engine_text::{
    Identifier, OFFSET_OF_SYMBOL_FLAGS, PropertyName, StringRef, SymbolRef, Text, names,
};
use bun_engine_vm::caches::{get_megamorphic, has_megamorphic, has_own_property, put_megamorphic};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::*;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(GlobalObject::create_for_shadow_realm(cx, &HOOKS)),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

fn with_realm(body: impl FnOnce(&mut Cx)) {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
}

fn run(cx: &mut Cx, source: &str) -> Value {
    let (text, url) = (StringRef::from_str(source), StringRef::from_str("test.js"));
    let provider = SourceProvider::build(text, Some(url), SourceType::Program).finish();
    evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED)
        .unwrap_or_else(|thrown| cx.catch_value(thrown).unwrap())
}

fn text(cx: &mut Cx, value: Value) -> String {
    value.to_string_view(cx).unwrap().text().to_string()
}

fn run_to_text(cx: &mut Cx, source: &str) -> String {
    let value = run(cx, source);
    text(cx, value)
}

fn name(text: &str) -> Identifier {
    Identifier::new(Text::from_ascii(text))
}

struct Random(u64);

impl Random {
    fn below(&mut self, limit: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 20) as usize % limit
    }
}

#[derive(Default)]
struct Model {
    properties: Vec<(usize, u32, Attributes)>,
    is_closed: bool,
}

fn check(cx: &mut Cx, object: &JsObject, model: &Model, keys: &[Identifier]) {
    let (kinds, mode) = (PropertyNameMode::StringsAndSymbols, DontEnumMode::Include);
    let own = object.own_keys(cx, kinds, mode).unwrap();
    let of_kind = |is_symbol| {
        (model.properties.iter().map(|it| &keys[it.0]))
            .filter(move |key| key.name().is_symbol() == is_symbol)
    };
    assert!(own.iter().eq(of_kind(false).chain(of_kind(true))));
    let shape = object.shape();
    for &(key, value, attributes) in &model.properties {
        let found = object.get_direct_with_attributes(keys[key].name());
        assert_eq!(found, Some((value.into(), attributes)));
        for (attribute, flag) in [
            (Attributes::DONT_ENUM, ShapeFlags::HAS_NON_ENUMERABLE),
            (Attributes::DONT_DELETE, ShapeFlags::HAS_NON_CONFIGURABLE),
            (
                Attributes::READ_ONLY,
                ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO,
            ),
        ] {
            assert!(!attributes.contains(attribute) || shape.has(flag));
        }
    }
    if shape.has_properties_in_slot_order() {
        let slot = |number| PropertyOffset::for_slot(number, shape.inline_capacity());
        let offsets = shape.properties().iter().map(|it| it.1).collect::<Vec<_>>();
        assert_eq!(offsets, (0..own.len()).map(slot).collect::<Vec<_>>());
    }
}

#[test]
fn properties_follow_a_model() {
    with_realm(|cx| {
        let symbol = |_| SymbolRef::new(&StringRef::from_literal("symbol")).into();
        let keys: Vec<Identifier> = (0..200)
            .map(|index| name(&format!("key{index}")))
            .chain((0..4).map(symbol))
            .collect();
        let (mut random, mut objects, mut models) = (Random(1), root_vec(), Vec::new());
        objects.extend((0..12).map(|_| cx.new_object()));
        models.resize_with(objects.len(), Model::default);
        for value in 0..60_000u32 {
            let which = random.below(objects.len());
            let (object, model) = (objects[which], &mut models[which]);
            let key = match random.below(10) {
                0 => random.below(keys.len()),
                1 => 200 + random.below(4),
                _ => random.below(9),
            };
            let (name, at) = (
                keys[key].name(),
                model.properties.iter().position(|it| it.0 == key),
            );
            let current = at.map(|at| model.properties[at].2);
            match random.below(40) {
                0..16 => {
                    let expected = current.map_or(!model.is_closed, Attributes::is_writable);
                    put_megamorphic(cx, object, name, value.into(), false).unwrap();
                    match at {
                        Some(at) if expected => model.properties[at].1 = value,
                        None if expected => model.properties.push((key, value, Attributes::NONE)),
                        _ => {}
                    }
                }
                16..24 => {
                    let expected = current.is_none_or(Attributes::is_configurable);
                    assert_eq!(object.delete(cx, name).unwrap(), expected);
                    model.properties.retain(|it| !expected || it.0 != key);
                }
                24..30 if current.map_or(!model.is_closed, Attributes::is_configurable) => {
                    let mut attributes = Attributes::NONE;
                    attributes.set(Attributes::READ_ONLY, random.below(4) == 0);
                    attributes.set(Attributes::DONT_ENUM, random.below(4) == 0);
                    attributes.set(Attributes::DONT_DELETE, random.below(30) == 0);
                    let descriptor = PropertyDescriptor::data(value.into(), attributes);
                    object
                        .define_property_or_throw(cx, name, &descriptor)
                        .unwrap();
                    match at {
                        Some(at) => model.properties[at] = (key, value, attributes),
                        None => model.properties.push((key, value, attributes)),
                    }
                }
                30..34 => {
                    let expected = at.map_or(Value::UNDEFINED, |at| model.properties[at].1.into());
                    assert_eq!(get_megamorphic(cx, object.into(), name).unwrap(), expected);
                    assert_eq!(has_megamorphic(cx, object, name).unwrap(), at.is_some());
                    assert_eq!(has_own_property(cx, &object, name).unwrap(), at.is_some());
                }
                34 => {
                    objects[which] = clone_object(cx, object.into()).unwrap();
                    model.properties.retain(|it| it.2.is_enumerable());
                    (model.properties.iter_mut()).for_each(|it| it.2 = Attributes::NONE);
                    model.is_closed = false;
                }
                35 if random.below(10) == 0 => {
                    object.freeze_or_throw(cx).unwrap();
                    let frozen = Attributes::READ_ONLY | Attributes::DONT_DELETE;
                    model.properties.iter_mut().for_each(|it| it.2 |= frozen);
                    model.is_closed = true;
                }
                36 => object.flatten_dictionary(cx),
                37 if random.below(4) == 0 => {
                    (objects[which], *model) = (cx.new_object(), Model::default());
                }
                38 if random.below(20) == 0 => cx.heap.collect_and_sweep(Some(Scope::Full)),
                39 if random.below(20) == 0 => cx.heap.collect_and_sweep(Some(Scope::Eden)),
                _ => {}
            }
            check(cx, &objects[which], &models[which], &keys);
        }
    });
}

#[test]
fn using_the_library_leaves_its_shapes_alone() {
    with_realm(|cx| {
        let shapes = |cx: &Cx| [cx.object_prototype(), cx.array_prototype()].map(|it| it.shape());
        let before = shapes(cx);
        run(
            cx,
            "({}).hasOwnProperty('x'); ({}).__proto__; [].map(String); ({ ...Array.prototype })",
        );
        assert!(shapes(cx) == before);
        assert!(before.iter().all(|shape| shape.is_worth_watching()));
        assert!(cx.global().array_prototype_chain_is_sane());
        assert!(!before[0].has(ShapeFlags::HAS_READ_ONLY_OR_ACCESSOR_EXCLUDING_PROTO));
    });
}

#[test]
fn the_library_keeps_the_order_of_its_keys() {
    with_realm(|cx| {
        let source = "[[Object, 'seal'], [Object, 'length'], [Symbol, 'keyFor'], [Object.prototype, 'valueOf'],
            [Reflect, 'get']].every(([object, key]) => {
                const expected = Reflect.ownKeys(object).filter(it => it !== key);
                object[expected.at(-1)];
                delete object[key];
                return Reflect.ownKeys(object).every((it, index) => it === expected[index]);
            })";
        assert_eq!(run(cx, source), Value::TRUE);
        let source = "Math.extra = 1; Object.defineProperty(Math, 'sin', { enumerable: true }); Object.keys(Math)";
        assert_eq!(run_to_text(cx, source), "sin,extra");
    });
}

#[test]
fn freezing_a_prototype_covers_what_has_not_been_used() {
    with_realm(|cx| {
        let source =
            "Object.freeze(Array.prototype); Array.prototype.flat = 1; delete Array.prototype.at;
            [typeof [].flat, typeof [].at, Object.isFrozen(Array.prototype)]";
        assert_eq!(run_to_text(cx, source), "function,function,true");
    });
}

#[test]
fn an_enumerator_is_shared_until_a_prototype_changes() {
    with_realm(|cx| {
        let source = "var base = { inherited: 1 }; var make = () => Object.assign(Object.create(base), { own: 1 })";
        run(cx, source);
        let enumerator = |cx: &mut Cx| {
            let object = run(cx, "make()").cast::<JsObject>();
            PropertyNameEnumerator::for_object(cx, &object).unwrap()
        };
        let first = enumerator(cx);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        run(cx, "Object.create({}).__proto__.unrelated = 1");
        assert!(enumerator(cx) == first);
        for (change, count) in [
            ("base.added = 1", 3),
            ("delete base.inherited", 2),
            (
                "Object.defineProperty(base, 'added', { enumerable: false })",
                1,
            ),
            ("Object.setPrototypeOf(base, { far: 1 })", 2),
            ("base.__proto__[0] = 1", 3),
            ("base.__proto__[1] = 1", 4),
        ] {
            run(cx, change);
            assert_eq!(enumerator(cx).names().len(), count, "{change}");
        }
    });
}

#[test]
fn shared_lookups_follow_prototypes() {
    with_realm(|cx| {
        run(
            cx,
            "var far = { x: 1 }, near = Object.create(far), object = Object.create(near), log = ''",
        );
        let (object, x) = (run(cx, "object"), name("x"));
        for (change, expected) in [
            ("", "1"),
            ("far.x = 2", "2"),
            ("near.x = 3", "3"),
            ("delete near.x", "2"),
            (
                "Object.defineProperty(far, 'x', { get() { return this === object } })",
                "true",
            ),
            ("Object.setPrototypeOf(near, null)", "undefined"),
            (
                "for (let i = 0; i < 300; i++) near['p' + i] = i; near.x = 4",
                "4",
            ),
            ("delete near.p0; delete near.x", "undefined"),
            ("near.x = 5", "5"),
        ] {
            run(cx, change);
            for _ in 0..2 {
                let value = get_megamorphic(cx, object, x.name()).unwrap();
                assert_eq!(text(cx, value), expected, "{change}");
            }
        }
        let y = name("y");
        for (change, is_added) in [
            ("", true),
            (
                "Object.defineProperty(near, 'y', { set(v) { log += v }, configurable: true })",
                false,
            ),
            (
                "Object.defineProperty(near, 'y', { value: 0, writable: true })",
                true,
            ),
            ("Object.freeze(near)", false),
        ] {
            run(cx, change);
            for _ in 0..2 {
                let object = run(cx, "Object.create(near)").cast::<JsObject>();
                put_megamorphic(cx, object, y.name(), 7.into(), false).unwrap();
                assert_eq!(object.get_direct(y.name()).is_some(), is_added, "{change}");
            }
        }
        assert_eq!(run_to_text(cx, "log"), "77");
    });
}

#[test]
fn a_prototype_with_many_properties_can_redefine_an_accessor_of_the_library() {
    with_realm(|cx| {
        let source = "const symbol = Symbol('original'), describe = it => it.description;
            for (let i = 0; i < 10; i++) describe(symbol);
            for (let i = 0; i < 300; i++) Symbol.prototype['p' + i] = i;
            Object.defineProperty(Symbol.prototype, 'description', { value: 'redefined' });
            describe(symbol)";
        assert_eq!(run_to_text(cx, source), "redefined");
    });
}

#[test]
fn an_accessor_of_the_library_is_found_after_its_holder_has_been_copied() {
    with_realm(|cx| {
        let source =
            "const tag = it => it[Symbol.toStringTag], heir = Object.create(Iterator.prototype);
            for (let i = 0; i < 300; i++) tag({ ['p' + i % 30]: 1 });
            [tag(heir), tag(heir), ({ ...Iterator.prototype }, tag(heir))]";
        assert_eq!(run_to_text(cx, source), "Iterator,Iterator,Iterator");
    });
}

#[test]
fn a_field_is_defined_however_many_shapes_the_class_has_seen() {
    with_realm(|cx| {
        let source = "class Base { constructor(object) { return object } }
            class Derived extends Base { field = 1 }
            const set = object => { object.field = 2 };
            const fixed = () => Object.defineProperty({}, 'field', { value: 0, writable: true });
            for (let round = 0; round < 100; round++) {
                for (let i = 0; i < 30; i++) set(new Derived({ ['p' + i]: 1 }));
                set(fixed());
            }
            try { new Derived(fixed()); 'stored' } catch (error) { error.name }";
        assert_eq!(run_to_text(cx, source), "TypeError");
    });
}

#[test]
fn arguments_see_an_indexed_setter_that_arrays_do_not_inherit() {
    with_realm(|cx| {
        let source = "function list() { 'use strict'; return arguments }
            list();
            Object.setPrototypeOf(Array.prototype, null);
            let calls = 0;
            Object.defineProperty(Object.prototype, 1, { set(value) { calls++ } });
            list()[1] = list(0)[1] = 5;
            calls";
        assert_eq!(run_to_text(cx, source), "2");
    });
}

#[test]
fn holes_do_not_lengthen_the_array_that_they_are_concatenated_to() {
    with_realm(|cx| {
        let source = "const array = [1, , ];
            delete array[0];
            array.constructor = { [Symbol.species]: function () { return array } };
            array.concat(array, array).length";
        assert_eq!(run_to_text(cx, source), "6");
    });
}

#[test]
fn a_store_to_an_index_asks_what_the_global_object_inherits_from_now() {
    with_realm(|cx| {
        let source = "new ShadowRealm().evaluate(`const log = [];
            Object.defineProperty(Object.prototype, 1, { set(value) { log.length = 9 } });
            Object.setPrototypeOf(globalThis, { __proto__: null, set 0(value) { log.length++ } });
            const heir = Object.create(globalThis);
            heir[0] = heir[1] = 5;
            log.length + Object.keys(heir).join()`)";
        assert_eq!(run_to_text(cx, source), "11");
    });
}

#[test]
fn copies_are_plain_and_complete() {
    with_realm(|cx| {
        let source = "class Point { #hidden = 0; x = 1; y = 2; static isPoint(it) { return #hidden in it } }
            const wide = Object.fromEntries(Array.from({ length: 90 }, (_, index) => ['k' + index, index]));
            let results = new Set;
            for (let round = 0; round < 3; round++) {
                const { x, ...rest } = new Point, { y, ...others } = new Point;
                const merged = { y: 0, z: 3, ...Object.freeze({ x: 4, y: 5 }), ...[6] };
                results.add(JSON.stringify([rest, others, merged, Point.isPoint({ ...new Point }),
                    Object.values({ a: 1, ...wide }).length, Object.assign({ k89: 0 }, wide).k89,
                    Object.isFrozen({ ...Object.freeze({ x }) })]));
            }
            [...results]";
        let expected = r#"[{"y":2},{"x":1},{"0":6,"y":5,"z":3,"x":4},false,91,89,false]"#;
        assert_eq!(run_to_text(cx, source), expected);
    });
}

#[test]
fn arguments_stay_mapped_as_long_as_they_should() {
    with_realm(|cx| {
        for capture in ["", "(() => a);"] {
            let source = format!(
                "(function (a, b, c) {{ {capture}
                    const log = [];
                    Object.defineProperty(arguments, 0, {{ enumerable: false }});
                    a = 'a'; log.push(arguments[0], Object.keys(arguments));
                    delete arguments[1]; arguments[1] = 'new'; log.push(b);
                    c = 'c'; Object.defineProperty(arguments, 2, {{ writable: false }}); c = 'later';
                    arguments.extra = 1;
                    log.push(arguments[2], arguments.length, Object.getOwnPropertyNames(arguments));
                    Object.freeze(arguments); a = 'after'; log.push(arguments[0], Object.isFrozen(arguments));
                    return log.join(' ');
                }})(1, 2, 3, 4)"
            );
            let expected = "a 1,2,3 2 c 4 0,1,2,3,length,callee,extra a true";
            assert_eq!(run_to_text(cx, &source), expected);
        }
        let source = "(function (a) { [].shift.call(arguments); return [a, arguments.length, ...arguments] })(1, 2, 3)";
        assert_eq!(run_to_text(cx, source), "2,2,2,3");
    });
}

#[test]
fn private_names_differ_between_evaluations_of_a_class() {
    with_realm(|cx| {
        let source = "const make = () => class { #x = 1; #m() {} static read(it) { return it.#x }
                static write(it) { it.#x = 2 } static call(it) { it.#m() } };
            const classes = Array.from({ length: 12 }, make);
            let failures = 0;
            for (let round = 0; round < 3; round++)
                for (const of of classes)
                    for (const by of classes)
                        for (const use of [by.read, by.write, by.call]) {
                            try { use(new of); failures += of !== by } catch { failures += of === by }
                        }
            failures";
        assert_eq!(run(cx, source), Value::ZERO);
    });
}

#[test]
fn traps_never_see_private_names() {
    with_realm(|cx| {
        let private = || SymbolRef::private(&StringRef::from_literal("private"));
        let (stays, passes) = (private(), private());
        // SAFETY: the flag that the static symbols of an embedder may have.
        unsafe {
            let flags = passes.name().as_ptr().byte_add(OFFSET_OF_SYMBOL_FLAGS);
            *flags.cast::<u32>().as_ptr() |= 1 << 3;
        }
        let source =
            "var calls = 0, target = {}; new Proxy(target, new Proxy({}, { get() { calls++ } }))";
        let (proxy, target) = (run(cx, source).cast::<JsObject>(), run(cx, "target"));
        for (name, reaches_target) in [(stays.name(), false), (passes.name(), true)] {
            assert_eq!(
                proxy.set(cx, name, Value::TRUE, false).unwrap(),
                reaches_target
            );
            assert_eq!(target.get(cx, name).unwrap().is_true(), reaches_target);
            assert_eq!(proxy.get(cx, name).unwrap().is_true(), reaches_target);
            assert_eq!(proxy.has_property(cx, name).unwrap(), reaches_target);
            assert_eq!(proxy.has_own_property(cx, name).unwrap(), reaches_target);
        }
        assert_eq!(run(cx, "calls"), Value::ZERO);
        let target = target.cast::<JsObject>();
        target.put_direct(cx, stays.name(), Value::TRUE, Attributes::NONE);
        proxy.freeze_or_throw(cx).unwrap();
        let attributes = |name: PropertyName<'_>| target.shape().get(name).unwrap().1;
        assert!(attributes(stays.name()).is_writable() && !attributes(passes.name()).is_writable());
    });
}

#[test]
fn the_helpers_of_compiled_code_do_what_proxies_do() {
    with_realm(|cx| {
        let global = cx.global();
        for (name, helper) in [
            (names::get, cx.private_proxy_get()),
            (names::has, cx.private_proxy_has()),
            (names::set, cx.private_proxy_set()),
        ] {
            global.put_direct(cx, name, helper.into(), Attributes::NONE);
        }
        let source = "const outcome = action => { try { return String(action()) } catch (error) { return String(error) } };
            const revoked = Proxy.revocable({}, {}); revoked.revoke();
            const targets = [() => ({ x: 1 }), () => Object.freeze({ x: 1 }), () => Object.preventExtensions({ x: 1 }),
                () => Object.defineProperty({}, 'x', { get: undefined })];
            const proxies = [() => revoked.proxy];
            for (const target of targets)
                for (const trap of [undefined, 1, () => true, () => false, () => 1])
                    proxies.push(() => new Proxy(target(), { get: trap, has: trap, set: trap }));
            proxies.flatMap(make => [
                [() => make().x, () => get.call(make(), 'x', {})],
                [() => 'x' in make(), () => has.call(make(), 'x')],
                [() => { make().x = 2 }, () => { const it = make(); set.call(it, 'x', it, 2, false) }],
                [() => { 'use strict'; make().x = 2 }, () => { const it = make(); set.call(it, 'x', it, 2, true) }],
            ]).map(pair => pair.map(outcome)).filter(([expected, actual]) => expected !== actual).join()";
        assert_eq!(run_to_text(cx, source), "");
    });
}

#[test]
fn a_proxy_is_called_in_the_realm_of_its_caller() {
    with_realm(|cx| {
        let other = GlobalObject::create(cx, &HOOKS);
        let source = "new Proxy(function () {}, { apply: (target, receiver, list) => list })";
        let proxy = run(cx.in_realm(other), source);
        (cx.global()).put_direct(cx, names::proxy, proxy, Attributes::NONE);
        assert_eq!(run(cx, "proxy() instanceof Array"), Value::TRUE);
    });
}

#[test]
fn inherited_fields_count_in_a_descriptor() {
    with_realm(|cx| {
        let source = "Object.defineProperty({}, 'x', {});
            Object.prototype.value = 5; Object.defineProperty({}, 'x', { enumerable: true }).x";
        assert_eq!(run(cx, source), 5.into());
    });
}

#[test]
fn a_setter_for_an_index_reaches_heirs_however_they_came_to_be() {
    with_realm(|cx| {
        let source = "
            const heirs = [
                base => Object.assign(Object.create(base), [1]),
                base => Object.setPrototypeOf([1], base),
                base => Reflect.construct(Array, [1], Object.assign(function () {}, { prototype: base })),
                base => { const middle = {}, heir = Object.assign(Object.create(middle), [1]);
                    Object.setPrototypeOf(middle, base); return heir; },
            ];
            const setter = log => ({ set() { log.push('set'); } });
            const interceptions = [
                (base, log) => Object.defineProperty(base, 1, setter(log)),
                (base, log) => Object.setPrototypeOf(base, Object.defineProperty({}, 1, setter(log))),
                (base, log) => Object.setPrototypeOf(base, new Proxy({}, setter(log))),
            ];
            const log = [];
            for (const make of [() => ({}), () => function () {}, () => new Date])
                for (const heir of heirs)
                    for (const intercept of interceptions) {
                        const base = make(), object = heir(base);
                        intercept(base, log);
                        object[1] = 2;
                    }
            log.length";
        assert_eq!(run_to_text(cx, source), "36");
    });
}

#[test]
fn built_in_code_does_not_see_what_scripts_declare_lexically() {
    with_realm(|cx| {
        let text = "(function () { \"use strict\"; return shadowed += 1; })";
        let provider = SourceProvider::build(StringRef::from_str(text), None, SourceType::Program);
        let source = SourceCode::whole(provider.finish());
        let (outline, kind) = (BuiltinOutline::of(text.as_bytes()), FunctionKind::Method);
        let function = describe_builtin(&source, &outline, name("f"), kind, Visibility::Public);
        let executable = FunctionExecutable::create(cx, source.provider, function);
        let function = JsFunction::builtin(cx, executable).into();
        (cx.global()).put_direct(cx, name("f").name(), function, Attributes::NONE);
        assert_eq!(run_to_text(cx, "shadowed = 1; [f(), f(), f()]"), "2,3,4");
        let after = "let shadowed = 10; [f(), f(), f(), shadowed]";
        assert_eq!(run_to_text(cx, after), "5,6,7,10");
    });
}

#[test]
fn fields_that_a_constructor_assigns_count_once() {
    with_realm(|cx| {
        let source = "new class { a; b; c; d; e; f; g; h = 1; #i; constructor() {
            this.a = this.b = this.c = this.d = this.e = this.f = this.g = this.other = 0; } }";
        let object = run(cx, source).as_object().unwrap();
        assert_eq!(object.shape().inline_capacity(), 10);
    });
}

#[test]
fn an_array_that_is_converted_while_it_is_joined_converts_as_before_afterwards() {
    with_realm(|cx| {
        let source = "const make = () => [1, 2, 3], array = make();
            [array.join({ toString: () => `<${array}>` }), make()].join(' ')";
        assert_eq!(run_to_text(cx, source), "1<>2<>3 1,2,3");
    });
}

#[test]
fn a_field_is_defined_however_many_shapes_it_has_been_defined_on() {
    with_realm(|cx| {
        let source = "class Same { constructor(it) { return it; } }
            class Field extends Same { key = 1; }
            const assign = it => { it.key = 2; };
            for (let i = 0; i < 2000; i++) assign(new Field({ ['p' + i % 40]: 0, key: 0 }));
            [true, false].map(configurable => {
                const it = Object.defineProperty({}, 'key', { writable: true, configurable });
                assign(it);
                try { return Object.keys(new Field(it)); } catch (error) { return error.name; }
            })";
        assert_eq!(run_to_text(cx, source), "key,TypeError");
    });
}

#[test]
fn a_direct_load_finds_own_properties_however_many_shapes_it_has_seen() {
    with_realm(|cx| {
        let text = "(function (it) { \"use strict\"; return @getByIdDirect(it, \"key\"); })";
        let provider = SourceProvider::build(StringRef::from_str(text), None, SourceType::Program);
        let source = SourceCode::whole(provider.finish());
        let (outline, kind) = (BuiltinOutline::of(text.as_bytes()), FunctionKind::Method);
        let function = describe_builtin(&source, &outline, name("f"), kind, Visibility::Public);
        let executable = FunctionExecutable::create(cx, source.provider, function);
        let function = JsFunction::builtin(cx, executable).into();
        (cx.global()).put_direct(cx, name("own").name(), function, Attributes::NONE);
        let source = "const any = it => it.key;
            for (let i = 0; i < 2000; i++) [any, own].map(f => f({ ['p' + i % 40]: 0, key: 0 }));
            const heir = Object.create({ key: 1 });
            `${any(heir)} ${own(heir)}`";
        assert_eq!(run_to_text(cx, source), "1 undefined");
    });
}
