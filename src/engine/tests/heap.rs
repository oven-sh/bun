use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringRef, Text, names};
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

fn name(index: usize) -> Identifier {
    Identifier::new(Text::from_ascii(&format!("p{index}")))
}

fn text(cx: &mut Cx, value: Value) -> String {
    value.to_string_view(cx).unwrap().text().to_string()
}

#[test]
fn properties_survive_growth_deletion_and_collection() {
    with_realm(|cx| {
        let object = cx.new_object();
        for index in 0..700 {
            let value = JsString::from_text(cx, Text::from_ascii(&format!("value {index}")));
            object
                .set(cx, name(index).name(), value.into(), true)
                .unwrap();
            if index % 50 == 0 {
                cx.heap.collect_and_sweep(Some(Scope::Eden));
            }
        }
        assert!(object.shape().is_dictionary());
        for index in (0..700).step_by(3) {
            assert!(object.delete(cx, name(index).name()).unwrap());
        }
        cx.heap.collect_and_sweep(Some(Scope::Full));
        object.flatten_dictionary(cx);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        for index in 0..700 {
            let value = object.get(cx, name(index).name()).unwrap();
            let expected = match index % 3 {
                0 => "undefined".to_owned(),
                _ => format!("value {index}"),
            };
            assert_eq!(text(cx, value), expected);
        }
    });
}

#[test]
fn objects_share_shapes() {
    with_realm(|cx| {
        let make = |cx: &mut Cx| {
            let object = cx.new_object();
            for index in 0..20 {
                object
                    .set(cx, name(index).name(), index.into(), true)
                    .unwrap();
            }
            object
        };
        let first = make(cx);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(make(cx).shape() == first.shape());
    });
}

#[test]
fn arrays_change_kind() {
    with_realm(|cx| {
        let array = cx.new_array();
        for index in 0..1000 {
            array.push(cx, index.into()).unwrap();
        }
        assert_eq!(array.element_kind(), ElementKind::Int32);
        array.push(cx, 0.5.into()).unwrap();
        assert_eq!(array.element_kind(), ElementKind::Double);
        array.push(cx, Value::NULL).unwrap();
        assert_eq!(array.element_kind(), ElementKind::Contiguous);
        array.set_index(cx, 5_000_000, Value::TRUE, true).unwrap();
        assert_eq!(array.element_kind(), ElementKind::Sparse);
        assert_eq!(array.length(), 5_000_001);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(array.get_index(cx, 999).unwrap().as_number(), Some(999.0));
        array.set_length(cx, 1002, true).unwrap();
        array.push(cx, Value::TRUE).unwrap();
        assert_eq!(array.element_kind(), ElementKind::Contiguous);
    });
}

#[test]
fn a_queue_keeps_its_order() {
    with_realm(|cx| {
        let array = cx.new_array();
        array.put_direct(cx, name(0).name(), Value::TRUE, Attributes::NONE);
        let (mut next_in, mut next_out) = (0u32, 0u32);
        for round in 0..2000 {
            for _ in 0..3 {
                let object = cx.new_object();
                object.put_direct(cx, names::value, next_in.into(), Attributes::NONE);
                array.push(cx, object.into()).unwrap();
                next_in += 1;
            }
            for _ in 0..2 {
                let first = array.get_index(cx, 0).unwrap();
                assert_eq!(first.get(cx, names::value).unwrap(), next_out.into());
                assert!(array.try_shift(cx).is_some());
                next_out += 1;
            }
            if round % 100 == 0 {
                let length = u64::from(array.length());
                assert!(
                    array
                        .try_splice(cx, length, 1, 0, &[Value::NULL; 5])
                        .unwrap()
                );
                assert!(array.try_splice(cx, length + 5, 1, 5, &[]).unwrap());
                cx.heap.collect_and_sweep(None);
            }
        }
        assert_eq!(array.length(), next_in - next_out);
        assert_eq!(array.get_direct(name(0).name()), Some(Value::TRUE));
    });
}

#[test]
fn frozen_arrays_stay_dense() {
    with_realm(|cx| {
        let array = cx.new_array_from(&[1.into(), 2.into()]).unwrap();
        array
            .set_integrity_level(cx, IntegrityLevel::Frozen)
            .unwrap();
        assert_eq!(array.element_kind(), ElementKind::Int32);
        assert!(!array.set_index(cx, 0, 5.into(), false).unwrap());
        assert!(!array.set_index(cx, 2, 5.into(), false).unwrap());
        assert!(!array.delete_index(cx, 1).unwrap());
        assert!(
            array
                .test_integrity_level(cx, IntegrityLevel::Frozen)
                .unwrap()
        );
        let thrown = array.push(cx, 3.into()).unwrap_err();
        let error = cx.catch_value(thrown).unwrap();
        let message = error.get(cx, names::message).unwrap();
        assert_eq!(text(cx, message), errors::READ_ONLY_PROPERTY_WRITE);
    });
}

#[test]
fn deep_ropes_resolve() {
    with_realm(|cx| {
        let piece = JsString::from_literal(cx, "0123456789abcdef");
        let (mut left, mut right) = (piece, piece);
        for _ in 0..200_000 {
            left = JsString::concat(cx, left, piece).unwrap();
            right = JsString::concat(cx, piece, right).unwrap();
        }
        assert!(left.equals(cx, &right).unwrap());
        assert_eq!(left.len(), 16 * 200_001);
    });
}

#[test]
fn garbage_is_reclaimed_and_a_large_graph_is_kept() {
    with_realm(|cx| {
        fn tree(cx: &mut Cx, depth: u32) -> Value {
            if depth == 0 {
                return JsString::from_text(cx, Text::from_ascii("leaf")).into();
            }
            let children = [tree(cx, depth - 1), tree(cx, depth - 1)];
            cx.new_array_from(&children).unwrap().into()
        }
        fn count(cx: &mut Cx, value: Value) -> u32 {
            if value.is_string() {
                return 1;
            }
            let (a, b) = (
                value.get_index(cx, 0).unwrap(),
                value.get_index(cx, 1).unwrap(),
            );
            count(cx, a) + count(cx, b)
        }
        let kept = tree(cx, 17);
        for _ in 0..200 {
            tree(cx, 12);
        }
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(cx.heap.capacity() < 40 << 20);
        assert_eq!(count(cx, kept), 1 << 17);
    });
}

#[test]
fn handles() {
    with_realm(|cx| {
        #[inline(never)]
        fn make(cx: &Cx) -> Vec<(Strong<Gc<JsObject>>, Weak<JsObject>, Weak<JsObject>)> {
            let one = |_| {
                let kept = cx.new_object();
                let dropped = Weak::new(cx, cx.new_object());
                (Strong::new(cx, kept), Weak::new(cx, kept), dropped)
            };
            (0..1000).map(one).collect()
        }
        let handles = make(cx);
        cx.heap.collect_and_sweep(Some(Scope::Eden));
        assert!(handles.iter().all(|it| it.1.get(cx) == Some(it.0.get(cx))));
        assert!(handles.iter().filter(|it| it.2.is_live()).count() < 10);
    });
}

#[test]
fn cells_of_all_sizes_fill_the_gaps_between_survivors() {
    with_realm(|cx| {
        for length in [1, 3, 13, 40, 130, 500, 1000] {
            let mut kept = root_vec();
            for round in 0..4 {
                for index in 0..600 {
                    let tag =
                        JsString::from_text(cx, Text::from_ascii(&format!("{round} {index}")));
                    let array = cx.new_array_from(&[Value::NULL; 1000][..length]).unwrap();
                    array.push(cx, tag.into()).unwrap();
                    if index % (round + 2) == 0 {
                        kept.push((array, round, index));
                    }
                }
                cx.heap
                    .collect(Some(if round == 2 { Scope::Full } else { Scope::Eden }));
            }
            for &(array, round, index) in &kept {
                let tag = Value::from(array).get_index(cx, length as u32).unwrap();
                assert_eq!(text(cx, tag), format!("{round} {index}"));
            }
        }
    });
}

#[test]
fn native_functions_are_called_and_throw() {
    with_realm(|cx| {
        let constructor = cx.global().get(cx, names::Boolean).unwrap();
        assert_eq!(
            cx.call(constructor, Value::NULL, &[1.into()]).unwrap(),
            Value::TRUE
        );
        let object = cx
            .construct(constructor, &[Value::TRUE], constructor)
            .unwrap();
        let string = cx.invoke(object.into(), names::toString, &[]).unwrap();
        assert_eq!(text(cx, string), "true");
        let method = object.get(cx, names::valueOf).unwrap();
        let thrown = cx.call(method, Value::NULL, &[]).unwrap_err();
        assert!(cx.catch_value(thrown).unwrap().is::<ErrorInstance>());
        let thrown = cx.construct(method, &[], method).unwrap_err();
        let message = cx
            .catch_value(thrown)
            .unwrap()
            .get(cx, names::message)
            .unwrap();
        assert_eq!(text(cx, message), "function is not a constructor");
    });
}
