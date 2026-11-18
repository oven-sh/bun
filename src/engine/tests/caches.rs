//! An access gives the same result however often it has run before.

#![feature(negative_impls)]
#![allow(improper_ctypes_definitions)]

use bun_engine_macros::{cell, native_abi, object_ops};
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, PropertyName, StringRef};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::*;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(cx.global()),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

#[native_abi]
fn collect(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let is_full = frame.argument(0).is_true();
    (cx.heap).collect_and_sweep(Some(if is_full { Scope::Full } else { Scope::Eden }));
    Ok(Value::UNDEFINED)
}

/// Calls the function at each store and each `delete`.
#[cell(name = "Counter", ops)]
struct Counter {
    base: JsObject,
    count: Value,
}

#[object_ops]
impl Counter {
    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        cx.call(self.count, Value::UNDEFINED, &[])?;
        self.ordinary_put(cx, name, value, slot)
    }

    fn delete_property(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut DeletePropertySlot,
    ) -> JsResult<bool> {
        cx.call(self.count, Value::UNDEFINED, &[])?;
        self.ordinary_delete_property(cx, name, slot)
    }
}

#[native_abi]
fn counter(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let spec = ShapeSpec::of::<Counter>();
    let shape = Shape::cached(cx, cx.global(), frame.argument(0).cast(), spec);
    let (base, count) = (JsObjectInit::new(cx, shape), frame.argument(1));
    Ok(cx.allocate::<Counter>(CounterInit { base, count }).into())
}

/// `warm(f, object, ..)` runs the access on the object, after running it on `shapes` others that inherit the same.
const PRELUDE: &str = "
    const log = [];
    const attempt = (f, ...rest) => { try { return f(...rest); } catch (error) { return error.name; } };
    const see = (f, ...rest) => log.push(String(attempt(f, ...rest)));
    const warm = (f, object, ...rest) => {
        for (let i = 0; i < shapes; i++) {
            const other = Object.create(Object.getPrototypeOf(object));
            other['other' + i] = i;
            attempt(f, other, ...rest);
            attempt(f, other, ...rest);
        }
        for (let i = 0; i < turns; i++)
            attempt(f, object, ...rest);
    };
";

/// In the interpreter and in baseline code, with one case, a few, and too many.
fn check(source: &str, expected: &str) {
    set_options(Options::default());
    for (turns, shapes) in [0, 3, 200]
        .into_iter()
        .flat_map(|it| [(it, 0), (it, 3), (it, 12)])
    {
        let vm = bun_engine::create_vm(HeapKind::Small);
        // SAFETY: nothing else uses the `Vm`.
        let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
        for (name, function) in [("collect", collect as NativeFunction), ("counter", counter)] {
            let function = JsFunction::native(cx, 1, &StringRef::from_str(name), function).into();
            let name = Identifier::from_literal(name);
            (cx.global()).put_direct(cx, name.name(), function, Attributes::NONE);
        }
        let text =
            format!("const turns = {turns}, shapes = {shapes};{PRELUDE}{source}; log.join()");
        let (text, url) = (StringRef::from_str(&text), StringRef::from_str("test.js"));
        let provider = SourceProvider::build(text, Some(url), SourceType::Program).finish();
        let result = evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED)
            .unwrap_or_else(|thrown| cx.catch_value(thrown).unwrap());
        let result = result.to_string_view(cx).unwrap().text().to_string();
        assert_eq!(result, expected, "{turns} turns, {shapes} shapes");
    }
}

#[test]
fn loads_follow_the_prototype_chain() {
    check(
        "for (const get of [o => o.x, (o, k) => o[k]]) {
            const top = { x: 1 }, middle = Object.create(top), object = Object.create(middle);
            const steps = [
                () => top.x = 2,
                () => top.x = 3,
                () => middle.x = 4,
                () => Object.defineProperty(middle, 'x', { get() { return this === object ? 5 : 0; } }),
                () => Object.defineProperty(middle, 'x', { get() { return 6; } }),
                () => delete middle.x,
                () => Object.setPrototypeOf(middle, null),
                () => Object.setPrototypeOf(middle, { x: 7 }),
                () => object.x = 8,
            ];
            for (const step of steps) { warm(get, object, 'x'); step(); see(get, object, 'x'); }
        }",
        "2,3,4,5,6,3,undefined,7,8,2,3,4,5,6,3,undefined,7,8",
    );
}

#[test]
fn stores_ask_the_prototype_chain() {
    check(
        "'use strict';
        const prototype = {};
        const add = (o, v) => { 'use strict'; const fresh = Object.create(o); fresh.x = v; return Object.keys(fresh); };
        const object = Object.create(prototype);
        warm(add, object, 1); see(add, object, 1);
        Object.defineProperty(prototype, 'x', { set(v) { this.y = v; }, configurable: true });
        see(add, object, 1); warm(add, object, 1);
        Object.defineProperty(prototype, 'x', { value: 0, writable: false });
        see(add, object, 1);
        const replace = (o, v) => { 'use strict'; o.z = v; return o.z; };
        warm(replace, object, 1); see(replace, object, 2);
        Object.freeze(object);
        see(replace, object, 3);",
        "x,y,TypeError,2,TypeError",
    );
}

#[test]
fn objects_grow() {
    check(
        "const fill = o => {
            const it = Object.create(o);
            it.a = 1; it.b = 2; it.c = 3; it.d = 4; it.e = 5; it.f = 6; it.g = 7; it.h = 8; it.i = 9; it.j = 10;
            it.k = 11; it.l = 12; it.m = 13; it.n = 14; it.o = 15; it.p = 16;
            return Object.values(it).join('');
        };
        warm(fill, {}); see(fill, {});",
        "12345678910111213141516",
    );
}

#[test]
fn fields_are_defined_and_not_assigned() {
    check(
        "class Base { constructor(o) { return o; } }
        class Stamp extends Base { x = 1; }
        const stamp = o => JSON.stringify(Object.getOwnPropertyDescriptor(new Stamp(o), 'x'));
        const assign = o => { o.x = 0; };
        const hidden = () => Object.defineProperty({}, 'x', { writable: true, configurable: true });
        const fixed = () => Object.defineProperty({}, 'x', { writable: true });
        for (const make of [hidden, fixed]) { warm(assign, make()); warm(stamp, {}); see(stamp, make()); }",
        r#"{"value":1,"writable":true,"enumerable":true,"configurable":true},TypeError"#,
    );
}

#[test]
fn private_names_belong_to_the_object() {
    check(
        "const make = () => class {
            #x = 1; #m() { return 2; }
            static get(o) { return o.#x; } static set(o) { o.#x = 3; return o.#x; }
            static has(o) { return #x in o; } static call(o) { return o.#m(); }
        };
        const [A, B] = [make(), make()], a = new A;
        for (const name of ['get', 'set', 'has', 'call']) {
            for (let i = 0; i < shapes; i++)
                A[name](new (class extends A {})), A[name](new (class extends A {}));
            warm(A[name], a); warm(B[name], new B);
            see(A[name], a); see(B[name], a); see(A[name], Object.create(a));
        }",
        "1,TypeError,TypeError,3,TypeError,TypeError,true,false,false,2,TypeError,TypeError",
    );
}

#[test]
fn questions_about_properties() {
    check(
        "const prototype = {}, object = Object.create(prototype);
        function F() {}
        const has = o => 'x' in o, remove = o => delete o.x, is = o => o instanceof F;
        warm(has, object); see(has, object); prototype.x = 1; see(has, object);
        warm(has, object); delete prototype.x; see(has, object);
        warm(remove, object); object.x = 1; see(remove, object); see(has, object);
        Object.defineProperty(object, 'x', { value: 1 }); warm(remove, object); see(remove, object);
        warm(is, object); see(is, object); Object.setPrototypeOf(prototype, F.prototype); see(is, object);
        warm(is, object); F.prototype = {}; see(is, object);",
        "false,true,false,true,false,false,false,true,false",
    );
}

#[test]
fn missing_elements_are_looked_for_in_prototypes() {
    check(
        "const get = (o, i) => o[i], has = (o, i) => i in o;
        for (const array of [[0, , 2], [0.5, , 2.5], ['a', , 'c'], new Array(3), {}]) {
            const prototype = Object.create(Object.getPrototypeOf(array));
            Object.setPrototypeOf(array, prototype);
            for (const index of [1, 5, -1]) {
                warm(get, array, index); warm(has, array, index);
                log.push(get(array, index) === undefined && !has(array, index));
            }
            prototype[1] = prototype[5] = prototype[-1] = 7;
            log.push([1, 5, -1].every(it => get(array, it) === 7 && has(array, it)));
        }",
        &["true"; 20].join(","),
    );
}

#[test]
fn views_follow_their_buffers() {
    check(
        "const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
        const measure = o => [o.length, o.byteLength, o.byteOffset, o[1], 1 in o].join(' ');
        const tracking = new Uint16Array(buffer, 2), fixed = new Uint16Array(buffer, 2, 2);
        const plain = new Uint16Array(new ArrayBuffer(8), 2);
        for (const length of [16, 4, 0, 8]) {
            warm(measure, tracking); warm(measure, fixed);
            buffer.resize(length);
            see(measure, tracking); see(measure, fixed);
        }
        warm(measure, plain); see(measure, plain); plain.buffer.transfer(); see(measure, plain);",
        "7 14 2 0 true,2 4 2 0 true,1 2 2  false,0 0 0  false,0 0 0  false,0 0 0  false,\
         3 6 2 0 true,2 4 2 0 true,3 6 2 0 true,0 0 0  false",
    );
}

#[test]
fn the_length_of_an_array_is_set() {
    check(
        "const resize = (o, n) => { 'use strict'; o.length = n; return o.length + ':' + o[1]; };
        for (const make of [() => [1, 2, 3].slice(), () => [1.5, 2.5, 3.5].slice()]) {
            const array = make();
            warm(resize, make(), 2);
            see(resize, array, 1); see(resize, array, 3); see(resize, array, -1);
            see(resize, Object.freeze(make()), 1);
        }",
        "1:undefined,3:undefined,RangeError,TypeError,1:undefined,3:undefined,RangeError,TypeError",
    );
}

#[test]
fn global_names_are_resolved_anew() {
    check(
        "const read = () => typeof late + ' ' + typeof globalThis.late;
        const steps = [
            () => Object.prototype.late = 1,
            () => Object.defineProperty(globalThis, 'late', { get: () => 'a', configurable: true }),
            () => delete globalThis.late,
            () => delete Object.prototype.late,
            () => (0, eval)('var late = true'),
        ];
        for (const step of steps) { warm(read, {}); step(); see(read); }
        function shadow(text) { eval(text); return late; }
        for (let i = 0; i < turns; i++) shadow('');
        see(shadow, ''); see(shadow, 'var late = 2'); see(shadow, '');",
        "number number,string string,number number,undefined undefined,boolean boolean,true,2,true",
    );
}

#[test]
fn proxies_are_asked_each_time() {
    check(
        "const handler = {}, proxy = new Proxy({ x: 1, 0: 2 }, handler);
        const all = (o, k) => [o.x, o[k], k in o, o[k] = 3].join(' ');
        for (const key of ['x', 0]) {
            delete handler.get; delete handler.has;
            warm(all, proxy, key); all(proxy, key); see(all, proxy, key);
            handler.get = (target, name) => typeof name; handler.has = () => false;
            see(all, proxy, key);
        }",
        "3 3 true 3,string string false 3,3 3 true 3,string string false 3",
    );
}

#[test]
fn loops_see_what_changes_on_the_way() {
    check(
        "const keys = (o, change) => { let all = ''; for (const key in o) { change?.(o); all += key + o[key]; } return all; };
        const values = (o, change) => { let all = ''; for (const value of o) { change?.(o); change = null; all += value; } return all; };
        const inherited = () => Object.assign(Object.create({ c: 3 }), { 0: 0, a: 1, b: 2 });
        warm(keys, inherited());
        see(keys, inherited()); see(keys, inherited(), o => delete o.b);
        see(keys, inherited(), o => delete Object.getPrototypeOf(o).c);
        see(keys, Object.defineProperty(inherited(), 'c', { value: 4 }));
        for (const make of [() => [1, 2], () => new Set([1, 2]), () => new Map([[1, 2]]).keys(), () => 'ab', () => new Uint8Array(2)]) {
            for (let i = 0; i < turns; i++) values(make());
            see(values, make());
        }
        see(values, [1, 2], o => o.push(3)); see(values, new Set([1, 2]), o => { o.delete(2); o.add(4); });
        Object.getPrototypeOf([].values()).next = () => ({ done: true });
        log.push(values([1, 2]));",
        "00a1b2c3,00a1c3,00a1b2,00a1b2,12,12,1,ab,00,123,14,",
    );
}

#[test]
fn a_site_with_one_key_notices_another() {
    check(
        "const [a, b] = [Symbol(), Symbol()];
        const get = (o, k) => o[k], put = (o, k) => { const it = Object.create(o); it[k] = 9; return it[a] + ':' + it[b]; };
        const object = { [a]: 1, [b]: 2, a: 3, undefined: 4 };
        for (const [usual, other] of [[a, b], ['a', b], [undefined, 'a']]) {
            const site = (0, eval)(String(get));
            warm(site, object, usual); see(site, object, usual); see(site, object, other);
        }
        warm(put, object, a); see(put, object, a); see(put, object, b);",
        "1,2,3,2,4,3,9:2,1:9",
    );
}

#[test]
fn literals_get_the_prototype_that_they_name() {
    check(
        "const make = p => { const it = { __proto__: p, own: 1 }; return it.own + ':' + it.x; };
        for (const prototype of [{ x: 1 }, { x: 2 }]) { warm(make, prototype); see(make, prototype); }
        see(make, null); see(make, 0); see(make, { x: 3 });",
        "1:1,1:2,1:undefined,1:undefined,1:3",
    );
}

#[test]
fn any_function_can_be_an_accessor() {
    check(
        "const functions = [
            function (a, b, c) { return arguments.length + ':' + b; },
            function () { 'use strict'; return typeof this; },
            function () { throw new EvalError; },
            function () { return this.x; },
            function* () {}, class {}, Date.prototype.getTime, (() => 'bound').bind(), new Proxy(() => 'proxy', {}),
        ];
        for (const f of functions) {
            const [get, put] = [(0, eval)('o => o.x'), (0, eval)('o => { o.x = 1; }')];
            const own = Object.defineProperty({}, 'x', { get: f, set() { this.y = arguments.length; } });
            const inherited = Object.create(own);
            if (f === functions[3]) { see(get, own); continue; }
            warm(get, own); warm(get, inherited); warm(put, own); warm(put, inherited);
            put(inherited);
            log.push(String(attempt(get, own)) === String(attempt(get, inherited)) && inherited.y === 1);
            see(get, own);
        }
        Object.defineProperty(String.prototype, 'x', { get: functions[1] });
        const of = o => o.x;
        warm(of, 'a'); see(of, 'a');",
        "true,0:undefined,true,object,true,EvalError,RangeError,true,[object Generator],true,TypeError,\
         true,TypeError,true,bound,true,proxy,string",
    );
}

#[test]
fn large_tables_are_read_like_other_objects() {
    check(
        "const table = Object.create({ inherited: 1 });
        for (let i = 0; i < 3000; i++) table['k' + i] = i;
        const get = (o, k) => o[k];
        for (let i = 0; i < 20; i++) warm(get, { ['s' + i]: i }, 's' + i);
        warm(get, table, 'k7');
        see(get, table, 'k2999'); see(get, table, 'inherited'); see(get, table, 'none');
        delete table.k7; table.none = 2;
        see(get, table, 'k7'); see(get, table, 'none'); see(get, { k7: 3 }, 'k7'); see(get, 'ab', 'length');
        Object.defineProperty(table, 'k8', { get() { return this === table; } });
        see(get, table, 'k8');",
        "2999,1,undefined,undefined,2,3,2,true",
    );
}

#[test]
fn arguments_stand_for_captured_parameters() {
    check(
        "function make(a, b) { return [arguments, () => a + b, v => { b = v; }]; }
        const get = (o, i) => o[i], has = (o, i) => i in o, put = (o, i, v) => { o[i] = v; };
        const keys = o => { let all = ''; for (const key in o) all += key + o[key]; return all; };
        const [all, sum, set] = make(1, 2, 3), [few] = make(1);
        for (let i = 0; i < turns; i++) get(all, i % 3), has(all, i % 3), put(all, 0, 1), keys(all);
        set(5); put(all, 0, 4);
        see(get, all, 1); see(get, all, 2); see(get, all, 3); see(get, all, -1); see(get, few, 1);
        see(sum); see(has, few, 1); see(keys, all);
        Object.defineProperty(all, 0, { enumerable: false }); delete all[1];
        see(get, all, 1); see(has, all, 1); see(keys, all);",
        "5,3,undefined,undefined,undefined,9,false,041523,undefined,false,23",
    );
}

#[test]
fn accessors_are_called_after_unrelated_changes() {
    check(
        "class A { get x() { return 1; } set x(v) { this.y = v; } }
        class B { get x() { return 2; } set x(v) { this.z = v; } }
        const both = o => { o.x = 3; return [o.x, o.y, o.z].join(' '); };
        const disturb = () => { const p = { w: 0 }, o = Object.create(p), f = (0, eval)('o => o.w'); f(o); f(o); f(o); p.w = 1; };
        const [a, b] = [new A, new B];
        warm(both, a); warm(both, b);
        for (const object of [a, b, a]) { disturb(); see(both, object); }",
        "1 3 ,2  3,1 3 ",
    );
}

#[test]
fn exotic_objects_have_ordinary_properties_too() {
    check(
        "const makers = [() => [1], () => new String('a'), () => function (a) {}, () => new Error, () => new Uint8Array(1)];
        class Base { constructor(o) { return o; } }
        class Stamp extends Base { y = 2; }
        const put = (o, k) => { 'use strict'; o[k] = 1; return o[k]; }, remove = (o, k) => delete o[k];
        for (const make of makers) {
            const all = (o, k) => [attempt(put, o, k), new Stamp(o).y, remove(o, k), k in o].join(' ');
            for (let i = 0; i < turns; i++) all(make(), 'x'), all(Object.create(make()), 'x'), all(make(), 'length');
            see(all, make(), 'x'); see(all, Object.create(make()), 'x');
            see(all, make(), 'length'); see(all, Object.create(make()), 'length'); see(all, make(), '-0');
        }",
        "1 2 true false,1 2 true false,1 2 false true,1 2 true true,1 2 true false,\
         1 2 true false,1 2 true false,TypeError 2 false true,TypeError 2 true true,1 2 true false,\
         1 2 true false,1 2 true false,TypeError 2 true true,TypeError 2 true true,1 2 true false,\
         1 2 true false,1 2 true false,1 2 true false,1 2 true false,1 2 true false,\
         1 2 true false,1 2 true false,TypeError 2 true true,TypeError 2 true true, 2 true false",
    );
}

#[test]
fn collections_leave_the_answers_as_they_are() {
    check(
        "const sites = ['o => o.x', '(o, k) => o[k]', \"o => 'x' in o\", 'o => { const it = Object.create(o); it.x = 3; return Object.keys(it); }'];
        for (const isFull of [false, true]) {
            for (const site of sites.map(eval)) {
                const prototype = Object.create(null, { x: { value: 1, writable: true, configurable: true } });
                const object = Object.create(prototype);
                collect(isFull); warm(site, object, 'x');
                collect(isFull); see(site, object, 'x');
                Object.defineProperty(prototype, 'x', { value: 2, writable: false });
                collect(isFull); see(site, object, 'x');
                warm(site, object, 'x'); delete prototype.x;
                collect(isFull); see(site, object, 'x');
            }
        }",
        &["1,2,undefined,1,2,undefined,true,true,false,x,,x"; 2].join(","),
    );
}

#[test]
fn what_has_been_broken_stays_broken() {
    check(
        "const disturb = times => {
            for (let i = 0; i < times; i++) { const p = { w: 0 }, o = Object.create(p), f = (0, eval)('o => o.w'); f(o); f(o); f(o); p.w = 1; }
        };
        const sites = ['o => o.x', '(o, k) => o[k]', \"o => 'y' in o\", 'o => { const it = Object.create(o); it.y = 3; return Object.keys(it); }'];
        for (const text of sites) {
            const answers = new Set;
            for (let times = 0; times < 8; times++) {
                const site = (0, eval)(text);
                const prototype = Object.create(null, { x: { value: 1, writable: true } }), object = Object.create(prototype);
                collect(true); disturb(4); warm(site, object, 'x');
                prototype.x = 2; Object.defineProperty(prototype, 'y', { value: 0 });
                collect(true); disturb(times); answers.add(String(site(object, 'x')));
            }
            log.push([...answers].join('|'));
        }",
        "2,2,true,",
    );
}

#[test]
fn classes_that_have_a_say_are_asked_each_time() {
    check(
        "let count = 0;
        const prototype = { set inherited(v) {} }, make = () => counter(prototype, () => count++);
        const accesses = [
            o => { o.x = 1; }, o => { o.x = 1; o.x = 2; }, (o, k) => { o[k] = 1; }, o => { o.inherited = 1; },
            o => { Object.create(o).x = 1; }, o => { Object.create(o).inherited = 1; },
            o => delete o.x, o => { o.x = 1; delete o.x; }, o => { o.x = 1; for (const k in o) o[k] = 2; },
        ];
        for (const access of accesses) {
            warm(access, {}, 'x');
            for (let i = 0; i < turns; i++) access(make(), 'x');
            count = 0; access(make(), 'x'); log.push(count);
        }",
        "1,2,1,1,1,1,1,2,3",
    );
}
