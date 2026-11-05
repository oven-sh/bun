use crate::Feature;

#[cfg(target_vendor = "apple")]
#[doc(hidden)]
#[macro_export]
macro_rules! removable_entry_point_section {
    () => {
        ".pushsection __DWARF,__bun_entries,regular,debug"
    };
}

#[cfg(windows)]
#[doc(hidden)]
#[macro_export]
macro_rules! removable_entry_point_section {
    () => {
        ".pushsection .bun_removable_entry_points,\"yn\""
    };
}

#[cfg(not(any(target_vendor = "apple", windows)))]
#[doc(hidden)]
#[macro_export]
macro_rules! removable_entry_point_section {
    () => {
        ".pushsection .bun_removable_entry_points,\"e\",@progbits"
    };
}

#[cfg(not(miri))]
#[doc(hidden)]
#[macro_export]
macro_rules! record_removable_entry_point {
    ($feature:expr, $stub:expr, $entry:path) => {
        $crate::record_removable_entry_point!($feature, $stub, $entry, $crate::GuardOrigin::NativeCode)
    };
    ($feature:expr, $stub:expr, $entry:path, $origin:expr) => {
        // SAFETY: it emits no instruction.
        unsafe {
            ::core::arch::asm!(
                "2:",
                $crate::removable_entry_point_section!(),
                ".p2align 3",
                ".quad 2b",
                ".quad {entry}",
                ".short {feature}",
                ".byte {stub}",
                ".byte {origin}",
                ".long 0",
                ".popsection",
                entry = sym $entry,
                feature = const $feature,
                stub = const $stub,
                origin = const $origin as u8,
                options(nomem, nostack, preserves_flags),
            )
        }
    };
}

#[cfg(miri)]
#[doc(hidden)]
#[macro_export]
macro_rules! record_removable_entry_point {
    ($feature:expr, $stub:expr, $entry:path $(, $origin:expr)?) => {
        ()
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! removed_feature_stub {
    ($feature:ident, Abort) => {
        $crate::abort_for_removed_feature($crate::Feature::$feature)
    };
    ($feature:ident, ReturnDefault) => {
        ::core::default::Default::default()
    };
    ($feature:ident, $other:ident) => {
        ::core::compile_error!(
            "expected Abort or ReturnDefault: call_removable_or! takes any stub kind"
        )
    };
}

#[macro_export]
macro_rules! removable_body {
    ($feature:ident, $stub:ident, $body:block) => {
        $crate::entry_point::run_removable_body::<
            { $crate::Feature::$feature.index() },
            { $crate::StubKind::$stub as u8 },
            _,
            _,
            _,
        >(|| $body, || $crate::removed_feature_stub!($feature, $stub))
    };
}

#[macro_export]
macro_rules! removable_body_of_either {
    ($first:ident, $second:ident, $body:block) => {
        $crate::entry_point::run_body_of_either::<
            { $crate::Feature::$first.index() },
            { $crate::Feature::$second.index() },
            _,
            _,
        >(|| $body)
    };
}

#[macro_export]
macro_rules! removable_definition {
    ($feature:ident, $function:path) => {
        $crate::record_removable_entry_point!(
            { $crate::Feature::$feature.index() },
            { $crate::StubKind::Abort as u8 },
            $function,
            $crate::GuardOrigin::Definition
        )
    };
}

#[macro_export]
macro_rules! removable_host_function_definition {
    ($feature:ident, $function:path) => {
        $crate::record_removable_entry_point!(
            { $crate::Feature::$feature.index() },
            { $crate::StubKind::Throw as u8 },
            $function,
            $crate::GuardOrigin::Definition
        )
    };
}

#[macro_export]
macro_rules! call_removable {
    ($feature:ident, Abort, $function:path $(, $argument:expr)* $(,)?) => {{
        $crate::record_removable_entry_point!(
            { $crate::Feature::$feature.index() },
            { $crate::StubKind::Abort as u8 },
            $function
        );
        $function($($argument),*)
    }};
    ($feature:ident, $stub:ident, $function:path $(, $argument:expr)* $(,)?) => {
        $crate::call_removable_or!(
            $feature,
            $stub,
            { $crate::removed_feature_stub!($feature, $stub) },
            $function
            $(, $argument)*
        )
    };
}

#[macro_export]
macro_rules! call_removable_or {
    ($feature:ident, $stub:ident, $removed:block, $function:path $(, $argument:expr)* $(,)?) => {
        if $crate::is_removed($crate::Feature::$feature) $removed else {
            $crate::record_removable_entry_point!(
                { $crate::Feature::$feature.index() },
                { $crate::StubKind::$stub as u8 },
                $function
            );
            $function($($argument),*)
        }
    };
}

#[doc(hidden)]
#[inline(always)]
pub fn run_removable_body<
    const FEATURE: u16,
    const STUB: u8,
    R,
    B: FnOnce() -> R,
    S: FnOnce() -> R,
>(
    body: B,
    stub: S,
) -> R {
    const { assert!((FEATURE as usize) < Feature::INDEX_LIMIT) };
    if STUB != crate::StubKind::Abort as u8 && crate::state::is_removed_index(FEATURE) {
        return stub();
    }
    crate::record_removable_entry_point!(FEATURE, STUB, removable_body_entry_point::<R, B>);
    removable_body_entry_point::<R, B>(body)
}

#[doc(hidden)]
#[inline(always)]
pub fn run_body_of_either<const FIRST: u16, const SECOND: u16, R, B: FnOnce() -> R>(body: B) -> R {
    const {
        assert!((FIRST as usize) < Feature::INDEX_LIMIT && (SECOND as usize) < Feature::INDEX_LIMIT)
    };
    crate::record_removable_entry_point!(
        FIRST,
        crate::StubKind::Abort as u8,
        removable_body_entry_point::<R, B>
    );
    crate::record_removable_entry_point!(
        SECOND,
        crate::StubKind::Abort as u8,
        removable_body_entry_point::<R, B>
    );
    removable_body_entry_point::<R, B>(body)
}

#[doc(hidden)]
#[inline(never)]
pub fn removable_body_entry_point<R, B: FnOnce() -> R>(body: B) -> R {
    // The optimizer removes a call of a function that has no effect, also of one that it may not inline, and the link
    // expects a call behind every guard.
    // SAFETY: it emits no instruction.
    #[cfg(not(miri))]
    unsafe {
        ::core::arch::asm!("", options(nomem, nostack, preserves_flags))
    };
    body()
}

#[cfg(test)]
mod tests {
    use core::num::TryFromIntError;

    #[derive(Clone, Default, PartialEq, Eq, Debug)]
    struct Label(&'static str);

    impl Label {
        #[inline(never)]
        fn text(&self) -> &'static str {
            self.0
        }

        fn rename(&mut self, text: &'static str) {
            removable_body!(Tools, ReturnDefault, {
                self.0 = text;
            })
        }
    }

    mod math {
        #[inline(never)]
        pub(super) fn add(left: u32, right: u32) -> u32 {
            left + right
        }
    }

    #[inline(never)]
    fn answer() -> u32 {
        42
    }

    #[inline(never)]
    fn answer_of_removable_feature() -> u32 {
        removable_definition!(Tools, answer_of_removable_feature);
        43
    }

    #[test]
    fn definition_runs_its_body() {
        assert_eq!(answer_of_removable_feature(), 43);
    }

    #[inline(never)]
    fn first(items: &[u32]) -> &u32 {
        &items[0]
    }

    #[inline(never)]
    fn identity<T>(value: T) -> T {
        value
    }

    #[inline(never)]
    fn increment(counter: &mut u32) {
        *counter += 1;
    }

    fn next(counter: &mut u32) -> u32 {
        *counter += 1;
        *counter
    }

    fn checked_sum(left: u32, right: u32) -> Option<u32> {
        Some(call_removable_or!(
            Tools,
            Throw,
            { return None },
            math::add,
            left,
            right
        ))
    }

    fn doubled(value: u32) -> u32 {
        removable_body_of_either!(Tools, Install, { value * 2 })
    }

    #[test]
    fn body_of_either_feature_runs() {
        assert_eq!(doubled(21), 42);
    }

    fn successor_unless_zero(value: u32) -> u32 {
        removable_body!(Tools, Abort, {
            if value == 0 {
                return 7;
            }
            value + 1
        })
    }

    fn checked_successor(value: i64) -> Result<u32, TryFromIntError> {
        removable_body!(Tools, Abort, {
            let value = u32::try_from(value)?;
            Ok(value + 1)
        })
    }

    fn second(items: &[u32]) -> &u32 {
        removable_body!(Tools, Abort, { &items[1] })
    }

    fn second_mut(items: &mut [u32]) -> &mut u32 {
        removable_body!(Tools, Abort, { &mut items[1] })
    }

    fn unchanged(label: Label) -> Label {
        removable_body!(Tools, ReturnDefault, { label })
    }

    fn duplicate<T: Clone>(value: &T) -> T {
        removable_body!(Tools, Abort, { value.clone() })
    }

    fn increment_in_body(counter: &mut u32) {
        removable_body!(Tools, ReturnDefault, {
            *counter += 1;
        })
    }

    #[test]
    fn call_passes_values() {
        assert_eq!(call_removable!(Tools, Abort, math::add, 2, 3), 5);
        assert_eq!(call_removable!(Tools, ReturnDefault, math::add, 4, 5), 9);
    }

    #[test]
    fn call_passes_references() {
        let items = [11, 12];
        assert_eq!(call_removable!(Tools, Abort, first, &items), &11);
        let mut counter = 0;
        call_removable!(Tools, ReturnDefault, increment, &mut counter);
        assert_eq!(counter, 1);
    }

    #[test]
    fn call_accepts_trailing_comma() {
        assert_eq!(call_removable!(Tools, Abort, math::add, 4, 5,), 9);
        assert_eq!(call_removable!(Tools, Abort, answer,), 42);
    }

    #[test]
    fn call_accepts_no_arguments() {
        assert_eq!(call_removable!(Tools, Abort, answer), 42);
    }

    #[test]
    fn call_accepts_method_path() {
        let label = Label("name");
        assert_eq!(call_removable!(Tools, Abort, Label::text, &label), "name");
    }

    #[test]
    fn call_accepts_generic_path() {
        assert_eq!(call_removable!(Tools, Abort, identity::<u32>, 5), 5);
    }

    #[test]
    fn call_evaluates_arguments_once() {
        let mut counter = 0;
        let sum = call_removable!(Tools, Abort, math::add, next(&mut counter), 10);
        assert_eq!(sum, 11);
        assert_eq!(counter, 1);
    }

    #[test]
    fn call_or_passes_values() {
        assert_eq!(call_removable_or!(Tools, Throw, { 0 }, math::add, 2, 3), 5);
        let items = [11, 12];
        assert_eq!(call_removable_or!(Tools, Throw, { &0 }, first, &items), &11);
    }

    #[test]
    fn call_or_accepts_every_stub_kind() {
        assert_eq!(call_removable_or!(Tools, Abort, { 0 }, answer), 42);
        assert_eq!(call_removable_or!(Tools, Throw, { 0 }, answer), 42);
        assert_eq!(
            call_removable_or!(Tools, ReturnUndefined, { 0 }, answer),
            42
        );
        assert_eq!(call_removable_or!(Tools, ReturnDefault, { 0 }, answer), 42);
    }

    #[test]
    fn call_or_accepts_trailing_comma() {
        assert_eq!(call_removable_or!(Tools, Throw, { 0 }, math::add, 4, 5,), 9);
        assert_eq!(call_removable_or!(Tools, Throw, { 0 }, answer,), 42);
    }

    #[test]
    fn call_or_evaluates_arguments_once() {
        let mut counter = 0;
        let sum = call_removable_or!(Tools, Throw, { 0 }, math::add, next(&mut counter), 10);
        assert_eq!(sum, 11);
        assert_eq!(counter, 1);
    }

    #[test]
    fn call_or_skips_removed_arm() {
        let mut removed_arm_runs = 0;
        let result = call_removable_or!(
            Tools,
            Throw,
            {
                removed_arm_runs += 1;
                0
            },
            answer
        );
        assert_eq!(result, 42);
        assert_eq!(removed_arm_runs, 0);
    }

    #[test]
    fn call_or_removed_arm_can_return() {
        assert_eq!(checked_sum(2, 3), Some(5));
    }

    #[test]
    fn body_returns_early() {
        assert_eq!(successor_unless_zero(0), 7);
        assert_eq!(successor_unless_zero(2), 3);
    }

    #[test]
    fn body_propagates_errors() {
        assert_eq!(checked_successor(41), Ok(42));
        assert!(checked_successor(-1).is_err());
    }

    #[test]
    fn body_borrows_parameter() {
        assert_eq!(second(&[1, 2]), &2);
        let mut items = [1, 2];
        *second_mut(&mut items) = 5;
        assert_eq!(items, [1, 5]);
    }

    #[test]
    fn body_moves_parameter() {
        assert_eq!(unchanged(Label("moved")), Label("moved"));
    }

    #[test]
    fn body_in_generic_function() {
        assert_eq!(duplicate(&Label("original")), Label("original"));
        assert_eq!(duplicate(&7), 7);
    }

    #[test]
    fn body_returns_unit() {
        let mut counter = 0;
        increment_in_body(&mut counter);
        assert_eq!(counter, 1);
    }

    #[test]
    fn body_in_method() {
        let mut label = Label("old");
        label.rename("new");
        assert_eq!(label, Label("new"));
    }
}
