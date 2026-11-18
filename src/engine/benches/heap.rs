//! `cargo bench -p bun_engine --bench heap [group[/name[/runs]]] [option=value ...]`

#![allow(clippy::disallowed_macros, clippy::disallowed_methods)]

use core::hint::black_box;
use std::sync::OnceLock;
use std::time::Instant;

use bun_engine_standalone as _;
use bun_engine_text::{StringRef, Text, names};
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

struct Random(u64);

impl Random {
    fn below(&mut self, limit: u32) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (((self.0 >> 32) * u64::from(limit)) >> 32) as u32
    }
}

/// A part of the names to run, and how often.
static SELECTION: OnceLock<(String, Option<u32>)> = OnceLock::new();

fn is_selected(name: &str) -> bool {
    name.contains(&SELECTION.get().unwrap().0)
}

/// Prints the best time for one of `count` operations.
fn measure(name: &str, count: u32, runs: u32, mut run: impl FnMut()) {
    if !is_selected(name) {
        return;
    }
    let runs = SELECTION.get().unwrap().1.unwrap_or(runs);
    let time = |_| {
        let start = Instant::now();
        run();
        start.elapsed().as_secs_f64()
    };
    let best = (0..runs).map(time).fold(f64::INFINITY, f64::min);
    let each = best * 1e9 / f64::from(count);
    println!("{name:<44}{each:>9.2} ns{:>11.3} ms", best * 1e3);
}

fn node_shape(cx: &Cx) -> Gc<Shape> {
    let object = cx.new_object();
    for name in [names::next, names::second, names::value] {
        object.put_direct(cx, name, Value::NULL, Attributes::NONE);
    }
    object.shape()
}

fn node(cx: &Cx, shape: Gc<Shape>, values: [Value; 3]) -> Value {
    JsFinalObject::create_with_values(cx, shape, &values).into()
}

fn tree(cx: &Cx, shape: Gc<Shape>, depth: u32) -> Value {
    if depth == 0 {
        return Value::NULL;
    }
    let (left, right) = (tree(cx, shape, depth - 1), tree(cx, shape, depth - 1));
    node(cx, shape, [left, right, depth.into()])
}

fn string(cx: &Cx, number: u32) -> Value {
    let mut text = *b"a string 00000000";
    for (place, digit) in text.iter_mut().rev().take(8).enumerate() {
        *digit = b'a' + (number >> (place * 4) & 15) as u8;
    }
    JsString::from_text(cx, Text::Latin1(&text)).into()
}

fn array_of(cx: &mut Cx, count: u32, mut make: impl FnMut(&mut Cx, u32) -> Value) -> Gc<JsArray> {
    let array = cx.new_array();
    for index in 0..count {
        let value = make(cx, index);
        array.push(cx, value).unwrap();
    }
    array
}

fn allocation(cx: &mut Cx) {
    const COUNT: u32 = 20_000_000;
    let shape = node_shape(cx);
    measure("garbage objects", COUNT, 3, || {
        for _ in 0..COUNT {
            black_box(node(cx, shape, [Value::NULL; 3]));
        }
    });
    measure("garbage arrays", COUNT / 2, 3, || {
        for _ in 0..COUNT / 2 {
            black_box(cx.new_array_from(&[Value::NULL; 4]).unwrap());
        }
    });
    measure("garbage strings", COUNT / 4, 3, || {
        for index in 0..COUNT / 4 {
            black_box(string(cx, index));
        }
    });
    let piece = string(cx, 0).cast::<JsString>();
    measure("garbage ropes", COUNT, 3, || {
        for _ in 0..COUNT {
            black_box(JsString::concat(cx, piece, piece).unwrap());
        }
    });
    measure("garbage large arrays", 200_000, 3, || {
        for _ in 0..200_000 {
            black_box(cx.new_array_with_length(ElementKind::Int32, 2000).unwrap());
        }
    });
    measure("one in ten survives", COUNT / 2, 3, || {
        let kept = cx.new_array_with_length(ElementKind::Contiguous, 1 << 18);
        let (kept, mut random) = (kept.unwrap(), Random(1));
        for index in 0..COUNT / 2 {
            let object = node(cx, shape, [Value::NULL; 3]);
            if index % 10 == 0 {
                kept.try_set_dense(cx, random.below(1 << 18), object);
            }
        }
    });
}

fn growth(cx: &mut Cx) {
    let shape = node_shape(cx);
    measure("tree, first time", 1 << 22, 1, || {
        black_box(tree(cx, shape, 22));
    });
    measure("tree, again", 1 << 22, 3, || {
        black_box(tree(cx, shape, 22));
    });
    measure("push integers", 20_000_000, 3, || {
        black_box(array_of(cx, 20_000_000, |_, index| index.into()));
    });
    measure("push objects", 4_000_000, 3, || {
        black_box(array_of(cx, 4_000_000, |cx, _| {
            node(cx, shape, [Value::NULL; 3])
        }));
    });
}

fn full_collection(cx: &mut Cx, name: &str, count: u32, make: impl FnOnce(&mut Cx) -> Value) {
    if !is_selected(name) {
        return;
    }
    let made = make(cx);
    let kept = Strong::new(cx, made);
    cx.heap.collect_and_sweep(Some(Scope::Full));
    measure(name, count, 5, || cx.heap.collect(Some(Scope::Full)));
    drop(kept);
    cx.heap.collect_and_sweep(Some(Scope::Full));
}

fn marking(cx: &mut Cx) {
    const COUNT: u32 = 1 << 21;
    let shape = node_shape(cx);
    full_collection(cx, "mark nothing", 1, |_| Value::NULL);
    full_collection(cx, "mark a small tree", 1 << 13, |cx| tree(cx, shape, 13));
    full_collection(cx, "mark a tree", COUNT, |cx| tree(cx, shape, 21));
    full_collection(cx, "mark an array of objects", COUNT, |cx| {
        array_of(cx, COUNT, |cx, _| node(cx, shape, [Value::NULL; 3])).into()
    });
    full_collection(cx, "mark an array of strings", COUNT, |cx| {
        array_of(cx, COUNT, |cx, index| string(cx, index)).into()
    });
    full_collection(cx, "mark an array of arrays", COUNT, |cx| {
        let pair = |cx: &mut Cx, _| cx.new_array_from(&[Value::NULL; 2]).unwrap().into();
        array_of(cx, COUNT, pair).into()
    });
    full_collection(cx, "mark mixed trees among garbage", COUNT, |cx| {
        fn payload(cx: &Cx, shape: Gc<Shape>, depth: u32, tag: Gc<JsString>) -> Value {
            if depth == 0 {
                let array = cx.new_array_from(&[Value::ZERO; 4]).unwrap();
                let rope = JsString::concat(cx, tag, tag).unwrap();
                return node(cx, shape, [array.into(), rope.into(), Value::NULL]);
            }
            let (left, right) = (
                payload(cx, shape, depth - 1, tag),
                payload(cx, shape, depth - 1, tag),
            );
            node(cx, shape, [left, right, Value::NULL])
        }
        const TREES: u32 = COUNT / 128;
        let (trees, mut random) = (array_of(cx, TREES, |_, _| Value::NULL), Random(1));
        for index in 0..TREES * 8 {
            let tree = payload(cx, shape, 5, string(cx, index).cast());
            trees.try_set_dense(cx, random.below(TREES), tree);
        }
        trees.into()
    });
    full_collection(cx, "mark a list", COUNT, |cx| {
        (0..COUNT).fold(Value::NULL, |next, _| {
            node(cx, shape, [next, Value::NULL, Value::NULL])
        })
    });
    full_collection(cx, "mark a random graph", COUNT, |cx| {
        let nodes = array_of(cx, COUNT, |cx, _| node(cx, shape, [Value::NULL; 3]));
        let mut random = Random(1);
        for index in 0..COUNT {
            let from = nodes.try_get_dense(index).unwrap().cast::<JsObject>();
            for name in [names::next, names::second, names::value] {
                let to = nodes.try_get_dense(random.below(COUNT)).unwrap();
                from.put_direct(cx, name, to, Attributes::NONE);
            }
        }
        nodes.try_get_dense(0).unwrap()
    });
}

fn young_collections(cx: &mut Cx) {
    let shape = node_shape(cx);
    let old = Strong::new(cx, tree(cx, shape, 21));
    cx.heap.collect_and_sweep(Some(Scope::Full));
    measure("eden beside a large heap", 200, 3, || {
        for _ in 0..200 {
            black_box(node(cx, shape, [Value::NULL; 3]));
            cx.heap.collect(Some(Scope::Eden));
        }
    });
    drop(old);
    const HANDLES: u32 = 1_000_000;
    measure("weak handles to garbage", HANDLES, 3, || {
        for _ in 0..HANDLES {
            drop(black_box(Weak::new(cx, cx.new_object())));
        }
    });
    measure("strong handles", HANDLES, 3, || {
        for _ in 0..HANDLES {
            drop(black_box(Strong::new(cx, Value::NULL)));
        }
    });
}

fn sweeping(cx: &mut Cx) {
    const COUNT: u32 = 1 << 21;
    for every in [2, 16] {
        let (mut best, kept) = (f64::INFINITY, Strong::new(cx, Value::NULL));
        for _ in 0..3 {
            let all = array_of(cx, COUNT, |cx, index| string(cx, index));
            let some = |_: &mut Cx, index| all.try_get_dense(index * every).unwrap();
            let some = array_of(cx, COUNT / every, some);
            kept.set(cx, some.into());
            all.set_length(cx, 0, true).unwrap();
            cx.heap.collect(Some(Scope::Full));
            let start = Instant::now();
            cx.heap.sweep_synchronously();
            best = best.min(start.elapsed().as_secs_f64());
        }
        let name = format!("sweep strings, one in {every} lives");
        println!("{name:<44}{:>9.2} ns", best * 1e9 / f64::from(COUNT));
    }
}

fn map_with_keys(cx: &mut Cx, kind: &str, keys: Gc<JsArray>) {
    let count = keys.length();
    let rounds = (4_000_000 / count).max(1);
    let key = |index| keys.try_get_dense(index).unwrap();
    let mut map = JsMap::create(cx);
    measure(
        &format!("map set {count} {kind}"),
        count * rounds,
        3,
        || {
            for _ in 0..rounds {
                map = JsMap::create(cx);
                for index in 0..count {
                    map.set(cx, key(index), Value::TRUE).unwrap();
                }
            }
        },
    );
    measure(
        &format!("map get {count} {kind}"),
        count * rounds,
        3,
        || {
            for _ in 0..rounds {
                for index in 0..count {
                    black_box(map.get(cx, key(index)).unwrap());
                }
            }
        },
    );
    let mut random = Random(1);
    measure(
        &format!("map get {count} {kind} at random"),
        count * rounds,
        3,
        || {
            for _ in 0..count * rounds {
                black_box(map.get(cx, key(random.below(count))).unwrap());
            }
        },
    );
}

fn maps(cx: &mut Cx) {
    for count in [4, 100, 10_000, 1_000_000] {
        let keys = array_of(cx, count, |_, index| index.into());
        map_with_keys(cx, "integers", keys);
        let mut random = Random(9);
        let keys = array_of(cx, count, |_, _| random.below(1 << 30).into());
        map_with_keys(cx, "scattered integers", keys);
        let keys = array_of(cx, count, |cx, _| cx.new_object().into());
        map_with_keys(cx, "objects", keys);
        let keys = array_of(cx, count, |cx, index| string(cx, index));
        map_with_keys(cx, "strings", keys);
    }
    const COUNT: u32 = 10_000_000;
    let map = JsMap::create(cx);
    measure("map as a window", COUNT, 3, || {
        for index in 0..COUNT {
            map.set(cx, index.into(), Value::TRUE).unwrap();
            map.remove(cx, index.saturating_sub(100).into()).unwrap();
        }
    });
    measure("map evicting the oldest", COUNT, 3, || {
        for index in 0..COUNT {
            map.set(cx, index.into(), Value::TRUE).unwrap();
            if map.size() > 10_000 {
                map.remove(cx, map.cursor().next().unwrap().0).unwrap();
            }
        }
    });
    let shape = node_shape(cx);
    measure("map growing with new objects", 2_000_000, 3, || {
        let map = JsMap::create(cx);
        for index in 0..2_000_000 {
            (map.set(cx, index.into(), node(cx, shape, [Value::NULL; 3]))).unwrap();
        }
    });
    let weak = JsWeakMap::create(cx);
    measure("weak map with keys that die", COUNT, 3, || {
        for _ in 0..COUNT {
            weak.set(cx.new_object().cell(), Value::TRUE).unwrap();
        }
    });
    let keys = array_of(cx, 1_000_000, |cx, _| cx.new_object().into());
    let key = |index| keys.try_get_dense(index).unwrap().cast::<JsCell>();
    measure("weak map set 1000000", 1_000_000, 1, || {
        (0..1_000_000).for_each(|index| weak.set(key(index), key(index).into()).unwrap());
    });
    let mut random = Random(1);
    measure("weak map get 1000000 at random", COUNT, 3, || {
        for _ in 0..COUNT {
            black_box(weak.get(key(random.below(1_000_000))));
        }
    });
    measure("mark a weak map", 1_000_000, 3, || {
        cx.heap.collect(Some(Scope::Full))
    });
}

fn main() {
    let (mut options, mut filter) = (Options::default(), String::new());
    for argument in std::env::args().skip(1).filter(|it| it != "--bench") {
        match argument.split_once('=') {
            Some((name, value)) => assert!(options.set(name.as_bytes(), value.as_bytes())),
            None => filter = argument,
        }
    }
    set_options(options);
    let mut parts = filter.split('/');
    let (group, name) = (parts.next().unwrap(), parts.next().unwrap_or_default());
    let runs = parts.next().map(|runs| runs.parse().unwrap());
    SELECTION.set((name.to_owned(), runs)).unwrap();
    let groups: [(&str, fn(&mut Cx)); 6] = [
        ("growth", growth),
        ("allocation", allocation),
        ("marking", marking),
        ("young", young_collections),
        ("sweeping", sweeping),
        ("maps", maps),
    ];
    for (name, run) in groups.into_iter().filter(|it| it.0.contains(group)) {
        println!("== {name}");
        let vm = bun_engine::create_vm(HeapKind::Large);
        // SAFETY: nothing else uses the `Vm`.
        unsafe { run(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
    }
}
