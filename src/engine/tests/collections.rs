use core::cell::RefCell;
use core::time::Duration;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use bun_engine_macros::native_abi;
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

fn with_realm(body: impl FnOnce(&mut Cx)) {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
}

struct Random(u64);

impl Random {
    fn below(&mut self, limit: u32) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 20) as u32 % limit
    }
}

fn string(cx: &Cx, text: &str) -> Gc<JsString> {
    JsString::from_text(cx, Text::from_ascii(text))
}

fn tagged(cx: &Cx, tag: u32) -> Gc<JsObject> {
    let object = cx.new_object();
    object.put_direct(cx, names::value, tag.into(), Attributes::NONE);
    object
}

fn tag_of(value: Value) -> u32 {
    let tag = value.cast::<JsObject>().get_direct(names::value);
    tag.unwrap().as_uint32().unwrap()
}

/// A new value each time, where the kind allows it.
fn key(cx: &Cx, objects: &[Gc<JsObject>], id: u32) -> Value {
    match id % 6 {
        0 => Value::double(id.into()),
        1 => Value::double(f64::from(id) + 0.5),
        2 => string(cx, &format!("key {id}")).into(),
        3 => {
            let (left, right) = (
                string(cx, "a long enough rope "),
                string(cx, &id.to_string()),
            );
            JsString::concat(cx, left, right).unwrap().into()
        }
        4 => JsBigInt::from_small(cx, i64::from(id)).into(),
        _ => objects[id as usize].into(),
    }
}

/// The list of the specification, in which a removed entry leaves a gap.
#[derive(Default)]
struct Model(Vec<Option<(u32, u32)>>);

impl Model {
    fn find(&mut self, id: u32) -> Option<&mut Option<(u32, u32)>> {
        self.0.iter_mut().find(|it| it.is_some_and(|it| it.0 == id))
    }

    fn next(&self, position: &mut usize) -> Option<(u32, u32)> {
        while let Some(entry) = self.0.get(*position) {
            *position += 1;
            if entry.is_some() {
                return *entry;
            }
        }
        *position = usize::MAX;
        None
    }
}

fn run_against_model(cx: &mut Cx, seed: u64, ids: u32, uses_iterators: bool) {
    let mut objects = root_vec();
    objects.extend((0..ids).map(|_| cx.new_object()));
    let (mut random, mut model, map) = (Random(seed), Model::default(), JsMap::create(cx));
    let mut iterators = root_vec();
    let mut adds = 60;
    for step in 0..12_000 {
        if step % 1500 == 0 {
            adds = [75, 20, 50, 5][random.below(4) as usize];
        }
        let id = random.below(ids);
        match random.below(100) {
            dice if dice < 8 && uses_iterators => {
                if iterators.len() < 6 || random.below(20) == 0 {
                    iterators.push((JsMapIterator::create(cx, map, IterationKind::Values), 0));
                }
                let which = random.below(iterators.len() as u32) as usize;
                let (iterator, position) = &mut iterators[which];
                let expected = model.next(position).map(|it| it.1);
                assert_eq!(iterator.next(cx).unwrap().map(tag_of), expected);
            }
            8 if random.below(30) == 0 => {
                map.clear(cx);
                model.0.fill(None);
            }
            9 if random.below(8) == 0 => {
                let scope = [Scope::Eden, Scope::Eden, Scope::Full][random.below(3) as usize];
                cx.heap.collect_and_sweep(Some(scope));
            }
            10 if random.below(20) == 0 => {
                let copy = map.clone_with_shape(cx, cx.map_shape()).unwrap();
                let tags = model.0.iter().flatten().map(|it| it.1);
                assert!(copy.cursor().map(|it| tag_of(it.1)).eq(tags));
                let expected = model.find(id).map(|it| it.unwrap().1);
                let found = copy.find(cx, key(cx, &objects, id)).unwrap();
                assert_eq!(found.map(tag_of), expected);
            }
            _ if random.below(100) < adds => {
                map.set(cx, key(cx, &objects, id), tagged(cx, step).into())
                    .unwrap();
                match model.find(id) {
                    Some(entry) => *entry = Some((id, step)),
                    None => model.0.push(Some((id, step))),
                }
            }
            _ => {
                let id = match random.below(4) {
                    0 => model.0.iter().flatten().next().map_or(id, |it| it.0),
                    1 => model.0.iter().flatten().next_back().map_or(id, |it| it.0),
                    _ => id,
                };
                let removed = map.remove(cx, key(cx, &objects, id)).unwrap();
                assert_eq!(removed, model.find(id).map(Option::take).is_some());
            }
        }
        let expected = model.find(id).map(|it| it.unwrap().1);
        let found = map.find(cx, key(cx, &objects, id)).unwrap();
        assert_eq!(found.map(tag_of), expected);
        assert_eq!(map.size() as usize, model.0.iter().flatten().count());
        if !uses_iterators {
            model.0.retain(Option::is_some);
        }
    }
    let no_gc = cx.no_gc();
    let tags = model.0.iter().flatten().map(|it| it.1);
    assert!(map.items(&no_gc).map(|it| tag_of(it.1)).eq(tags));
}

#[test]
fn maps_behave_as_the_list_of_the_specification() {
    with_realm(|cx| {
        for seed in 1..=6 {
            for ids in [3, 12, 90, 900] {
                run_against_model(cx, seed * 0x9e37_79b9, ids, true);
                run_against_model(cx, seed * 0x9e37_79b9, ids, false);
            }
        }
    });
}

#[test]
fn keys_are_compared_by_same_value_zero() {
    with_realm(|cx| {
        let set = JsSet::create(cx);
        let other_nan = Value::double(f64::from_bits(0x7ff8_0000_0000_0001));
        let keys = [Value::double(-0.0), Value::ZERO, Value::NAN, other_nan];
        for key in keys {
            set.add(cx, key).unwrap();
        }
        assert!(set.cursor().eq([Value::ZERO, Value::NAN]));
        for key in [
            Value::UNDEFINED,
            Value::NULL,
            Value::FALSE,
            2147483648.0.into(),
        ] {
            assert!(!set.has(cx, key).unwrap());
            set.add(cx, key).unwrap();
            assert!(set.has(cx, key).unwrap());
        }
        assert!(!set.has(cx, i32::MAX.into()).unwrap());
        assert!(!set.has(cx, string(cx, "0").into()).unwrap());
        assert!(!set.has(cx, JsBigInt::from_small(cx, 0i64).into()).unwrap());
    });
}

#[test]
fn an_old_table_keeps_what_is_stored_in_it() {
    with_realm(|cx| {
        let map = JsMap::create(cx);
        for round in 0..40u32 {
            for index in 0..500 {
                let id = round * 500 + index;
                map.set(cx, id.into(), tagged(cx, id).into()).unwrap();
            }
            map.set(cx, round.into(), tagged(cx, round).into()).unwrap();
            cx.heap.collect_and_sweep(Some(Scope::Eden));
        }
        for _ in 0..50_000 {
            tagged(cx, u32::MAX);
        }
        assert!(map.cursor().map(|it| tag_of(it.1)).eq(0..20_000));
    });
}

fn set_of(cx: &Cx, numbers: impl IntoIterator<Item = u32>) -> Gc<JsSet> {
    let set = JsSet::create(cx);
    for number in numbers {
        set.add(cx, number.into()).unwrap();
    }
    set
}

#[test]
fn operations_on_two_sets() {
    with_realm(|cx| {
        let numbers = |set: JsResult<Gc<JsSet>>| -> Vec<u32> {
            let keys = set.unwrap().cursor();
            keys.map(|it| it.as_uint32().unwrap()).collect()
        };
        for (a, b) in [
            (0..0, 0..0),
            (0..5, 0..0),
            (0..300, 290..310),
            (3..9, 0..200),
        ] {
            for (a, b) in [(a.clone(), b.clone()), (b, a.clone()), (a.clone(), a)] {
                let (this, other) = (set_of(cx, a.clone().rev()), set_of(cx, b.clone()));
                let only_a: Vec<u32> = a.clone().rev().filter(|it| !b.contains(it)).collect();
                let only_b: Vec<u32> = b.clone().filter(|it| !a.contains(it)).collect();
                let mut both: Vec<u32> = b.clone().filter(|it| a.contains(it)).collect();
                if a.len() <= b.len() {
                    both.reverse();
                }
                let union: Vec<u32> = a.rev().chain(only_b.clone()).collect();
                assert_eq!(numbers(this.union(cx, &other)), union);
                assert_eq!(numbers(this.intersection(cx, &other)), both);
                assert_eq!(numbers(this.difference(cx, &other)), only_a);
                assert_eq!(this.is_subset_of(&other), only_a.is_empty());
                assert_eq!(this.is_disjoint_from(&other), both.is_empty());
                let either = [only_a, only_b].concat();
                assert_eq!(numbers(this.symmetric_difference(cx, &other)), either);
            }
        }
    });
}

#[test]
fn a_cursor_knows_its_collection() {
    with_realm(|cx| {
        let set = set_of(cx, 0..3);
        let mut cursor = set.cursor();
        assert_eq!(cursor.next(), Some(0.into()));
        for number in 3..100 {
            set.add(cx, number.into()).unwrap();
        }
        set.clear(cx);
        let iterator = JsSetIterator::create_at(cx, cursor, IterationKind::Values);
        assert!(iterator.iterated_object() == set);
        set.add(cx, Value::TRUE).unwrap();
        let rest = iterator.drain_to_array(cx).unwrap();
        assert_eq!(
            (rest.length(), rest.try_get_dense(0)),
            (1, Some(Value::TRUE))
        );
        set.add(cx, Value::FALSE).unwrap();
        assert_eq!(iterator.next(cx).unwrap(), None);
    });
}

#[inline(never)]
fn add_garbage(cx: &Cx, map: &JsWeakMap, set: &JsWeakSet, count: u32) {
    for _ in 0..count {
        let key = cx.new_object();
        map.set(key.cell(), key.into()).unwrap();
        set.add(key.cell()).unwrap();
    }
}

#[test]
fn weak_collections_lose_the_keys_that_die() {
    with_realm(|cx| {
        let (map, set) = (JsWeakMap::create(cx), JsWeakSet::create(cx));
        let (mut kept, mut random) = (root_vec(), Random(7));
        for round in 0..300 {
            for _ in 0..random.below(40) {
                let (key, tag) = (cx.new_object(), random.below(1000));
                map.set(key.cell(), tagged(cx, tag).into()).unwrap();
                set.add(key.cell()).unwrap();
                kept.push((key, tag));
                add_garbage(cx, &map, &set, random.below(3));
            }
            add_garbage(cx, &map, &set, [0, 5, 3000][random.below(3) as usize]);
            for _ in 0..random.below(30).min(kept.len() as u32) {
                let which = random.below(kept.len() as u32) as usize;
                if random.below(2) == 0 {
                    let (key, _) = kept.swap_remove(which);
                    assert!(map.remove(key.cell()) && set.remove(key.cell()));
                    assert!(!map.has(key.cell()) && !set.remove(key.cell()));
                } else {
                    kept[which].1 = round;
                    (map.set(kept[which].0.cell(), tagged(cx, round).into())).unwrap();
                }
            }
            let scope = if round % 7 == 0 {
                Scope::Full
            } else {
                Scope::Eden
            };
            cx.heap.collect_and_sweep(Some(scope));
            for &(key, tag) in &kept {
                assert_eq!(map.find(key.cell()).map(tag_of), Some(tag));
                assert!(set.has(key.cell()));
            }
            if scope == Scope::Full {
                assert!(map.size() as usize <= kept.len() + 20);
                assert!(set.size() as usize <= kept.len() + 20);
            }
        }
        let no_gc = cx.no_gc();
        assert_eq!(set.items(&no_gc).count(), set.size() as usize);
    });
}

#[test]
fn a_chain_of_weak_entries_lives_and_dies_with_its_head() {
    with_realm(|cx| {
        #[inline(never)]
        fn chain(cx: &Cx, maps: [Gc<JsWeakMap>; 2], length: usize) -> Strong<Gc<JsObject>> {
            let mut keys = root_vec();
            keys.extend((0..=length).map(|_| cx.new_object()));
            for index in (0..length).rev() {
                (maps[index % 2].set(keys[index].cell(), keys[index + 1].into())).unwrap();
            }
            Strong::new(cx, keys[0])
        }
        let maps = [JsWeakMap::create(cx), JsWeakMap::create(cx)];
        let head = chain(cx, maps, 600);
        for scope in [Scope::Eden, Scope::Full] {
            cx.heap.collect_and_sweep(Some(scope));
            assert_eq!(maps[0].size() + maps[1].size(), 600);
        }
        drop(head);
        drop(chain(cx, [JsWeakMap::create(cx); 2], 1));
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(maps[0].size() + maps[1].size() < 600);
    });
}

#[test]
fn weak_references_hold_until_the_job_ends() {
    with_realm(|cx| {
        #[inline(never)]
        fn make(cx: &Cx) -> RootVec<Gc<JsWeakRef>> {
            let one =
                |_| JsWeakRef::create_with_shape(cx, cx.weak_ref_shape(), cx.new_object().cell());
            let mut references = root_vec();
            references.extend((0..500).map(one));
            references
        }
        #[inline(never)]
        fn count_live(cx: &Cx, references: &[Gc<JsWeakRef>]) -> usize {
            let targets = references.iter().map(|it| it.deref_target(cx));
            targets.filter(Option::is_some).count()
        }
        let references = make(cx);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        cx.clear_kept_objects();
        assert_eq!(count_live(cx, &references[..250]), 250);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(count_live(cx, &references[..250]), 250);
        assert!(count_live(cx, &references[250..]) < 10);
        cx.clear_kept_objects();
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(count_live(cx, &references) < 20);
    });
}

thread_local! {
    static FINALIZED: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
}

#[native_abi]
fn record_tag(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    FINALIZED.with_borrow_mut(|tags| tags.push(tag_of(frame.argument(0))));
    Ok(Value::UNDEFINED)
}

#[test]
fn finalization_registries_call_back_for_the_dead() {
    with_realm(|cx| {
        #[inline(never)]
        fn register(cx: &mut Cx, registry: &JsFinalizationRegistry, kept: &[Gc<JsObject>]) {
            for tag in 0..600 {
                let (target, held) = (cx.new_object().cell(), tagged(cx, tag).into());
                let (target, token) = match tag % 6 {
                    0 => (target, None),
                    1 => (target, Some(target)),
                    2 => (target, Some(kept[0].cell())),
                    3 => (target, Some(kept[1].cell())),
                    4 => (kept[2].cell(), Some(target)),
                    _ => (kept[2].cell(), None),
                };
                registry.register(cx, target, held, token).unwrap();
            }
        }
        let run_loop = RunLoop::install(cx);
        let callback = JsFunction::native(cx, 1, &StringRef::empty(), record_tag).upcast();
        let shape = cx.finalization_registry_shape();
        let registry = JsFinalizationRegistry::create_with_shape(cx, shape, callback);
        let kept = [cx.new_object(), cx.new_object(), cx.new_object()];
        for scope in [Scope::Eden, Scope::Eden, Scope::Full] {
            register(cx, &registry, &kept);
            cx.heap.collect_and_sweep(Some(scope));
            cx.heap.collect_and_sweep(Some(Scope::Eden));
            assert!(registry.unregister(cx, kept[1].cell()));
            assert!(!registry.unregister(cx, kept[1].cell()));
            assert!(run_loop.has_pending_work());
            run_loop.run(cx).unwrap();
            let tags = FINALIZED.take();
            assert!(tags.iter().all(|tag| tag % 6 < 3));
            assert!((290..=310).contains(&tags.len()));
        }
        let snapshot = registry.snapshot(cx);
        let of_kept = snapshot
            .iter()
            .filter(|it| it.target == Some(kept[2].cell()));
        assert_eq!(
            of_kept.filter(|it| tag_of(it.held_value) % 6 >= 4).count(),
            600
        );
    });
}

#[test]
fn tickets_keep_their_cells_and_run_from_other_threads() {
    with_realm(|cx| {
        #[inline(never)]
        fn add(cx: &Cx, tag: u32) -> WeakTicket {
            let dependency = tagged(cx, tag + 1).cell();
            cx.add_pending_work(WorkKind::AtSomePoint, tagged(cx, tag), &[dependency])
        }
        let (run_loop, sum) = (RunLoop::install(cx), Arc::new(AtomicU32::new(0)));
        let task = |sum: &Arc<AtomicU32>| {
            let sum = Arc::clone(sum);
            move |cx: &mut Cx, ticket: &Ticket| {
                cx.heap.collect_and_sweep(Some(Scope::Full));
                let target = ticket.target(cx).unwrap().into();
                let dependency = ticket.dependency(cx, 0).unwrap().into();
                sum.fetch_add(tag_of(target) + tag_of(dependency), Ordering::Relaxed);
                Ok(())
            }
        };
        let [first, second, cancelled] = [10, 100, 1000].map(|tag| add(cx, tag));
        cx.heap.collect_and_sweep(Some(Scope::Eden));
        cx.heap.collect_and_sweep(Some(Scope::Full));
        let (from_thread, from_timer) = (task(&sum), task(&sum));
        let other = cancelled.clone();
        let thread = std::thread::Builder::new().spawn(move || {
            assert!(first.schedule(from_thread));
            assert!(other.cancel());
        });
        cx.timer_queue().start(Duration::from_millis(1), move |_| {
            assert!(second.schedule(from_timer));
        });
        let never = (cx.timer_queue()).start(Duration::ZERO, |_| unreachable!());
        assert!(never.cancel());
        run_loop.run(cx).unwrap();
        thread.unwrap().join().unwrap();
        assert_eq!(sum.load(Ordering::Relaxed), 21 + 201);
        assert!(!cancelled.schedule(task(&sum)));
    });
}

#[test]
fn work_that_is_waited_for_keeps_its_realm() {
    with_realm(|cx| {
        #[inline(never)]
        fn add_in_new_realms(cx: &mut Cx) -> Vec<WeakTicket> {
            let one = |_| {
                let cx = cx.in_realm(GlobalObject::create(cx, &HOOKS));
                cx.add_pending_work(WorkKind::ImminentlyScheduled, cx.new_object(), &[])
            };
            (0..20).map(one).collect()
        }
        RunLoop::install(cx);
        let tickets = add_in_new_realms(cx);
        for scope in [Scope::Eden, Scope::Full] {
            cx.heap.collect_and_sweep(Some(scope));
            assert!(tickets.iter().all(WeakTicket::is_active));
        }
    });
}

#[test]
fn tickets_are_cancelled_with_their_realm() {
    let mut last = WeakTicket::default();
    with_realm(|cx| {
        #[inline(never)]
        fn add_in_new_realms(cx: &mut Cx) -> Vec<WeakTicket> {
            let one = |_| {
                let cx = cx.in_realm(GlobalObject::create(cx, &HOOKS));
                cx.add_pending_work(WorkKind::AtSomePoint, cx.new_object(), &[])
            };
            (0..20).map(one).collect()
        }
        RunLoop::install(cx);
        let tickets = add_in_new_realms(cx);
        assert!(tickets.iter().all(WeakTicket::is_active));
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(tickets.iter().filter(|it| it.is_active()).count() < 5);
        last = cx.add_pending_work(WorkKind::AtSomePoint, cx.new_object(), &[]);
        assert!(last.is_active());
    });
    assert!(!last.schedule(|_, _| unreachable!()));
}
