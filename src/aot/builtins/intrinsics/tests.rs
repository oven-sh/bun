use super::*;
use crate::builtins::table::{Conversion, ErrorKind};
use crate::ir::Opcode;
use bun_sema::atom::Interner;
use bun_sema::session::Session;

struct Spellings<'a, 's> {
    atoms: &'a Interner<'s>,
    names: &'a BuiltinNames,
}

impl Spellings<'_, '_> {
    fn intrinsic(&self, spelling: &str, position: IntrinsicPosition) -> Option<Intrinsic> {
        find_intrinsic(self.names, self.atoms.intern(spelling.as_bytes()), position)
    }

    fn symbol_key(&self, spelling: &str) -> Option<WellKnownSymbol> {
        find_symbol_key(self.names, self.atoms.intern(spelling.as_bytes()))
    }

    fn native_call_kind(&self, spelling: &str) -> Option<NativeCallKind> {
        find_native_call_kind(self.names, self.atoms.intern(spelling.as_bytes()))
    }
}

fn with_names<R>(then: impl FnOnce(&Spellings<'_, '_>) -> R) -> R {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let names = BuiltinNames::new(&atoms);
    then(&Spellings {
        atoms: &atoms,
        names: &names,
    })
}

#[test]
fn resolves_private_spellings_by_position() {
    with_names(|spellings| {
        assert!(matches!(
            spellings.intrinsic("$toLength", IntrinsicPosition::Call),
            Some(Intrinsic::Operation(Opcode::ToLength))
        ));
        assert!(matches!(
            spellings.intrinsic("$isObject", IntrinsicPosition::Call),
            Some(Intrinsic::IsObject)
        ));
        assert!(matches!(
            spellings.intrinsic("$isCallable", IntrinsicPosition::Call),
            Some(Intrinsic::IsCallable)
        ));
        assert!(matches!(
            spellings.intrinsic("$call", IntrinsicPosition::Member),
            Some(Intrinsic::Call { is_never_inlined: false })
        ));
        assert!(matches!(
            spellings.intrinsic("$callNoInline", IntrinsicPosition::Call),
            Some(Intrinsic::Call { is_never_inlined: true })
        ));
        assert_eq!(spellings.native_call_kind("$cpp"), Some(NativeCallKind::Cpp));
    });
}

#[test]
fn rejects_other_positions_and_spellings() {
    with_names(|spellings| {
        assert!(spellings.intrinsic("$isObject", IntrinsicPosition::Member).is_none());
        assert!(spellings.intrinsic("$isObject", IntrinsicPosition::Value).is_none());
        assert!(spellings.intrinsic("isObject", IntrinsicPosition::Call).is_none());
        assert!(spellings.intrinsic("$$isObject", IntrinsicPosition::Call).is_none());
        assert!(spellings.intrinsic("$notAnIntrinsic", IntrinsicPosition::Call).is_none());
        assert_eq!(spellings.native_call_kind("$isObject"), None);
        assert_eq!(spellings.native_call_kind("cpp"), None);
    });
}

#[test]
fn position_selects_entry() {
    with_names(|spellings| {
        assert!(matches!(
            spellings.intrinsic("$isArray", IntrinsicPosition::Call),
            Some(Intrinsic::Builtin(table::BuiltinId::ArrayIsArray))
        ));
        assert!(matches!(
            spellings.intrinsic("$isArray", IntrinsicPosition::Value),
            Some(Intrinsic::Builtin(table::BuiltinId::LinkTimeConstantIsArray))
        ));
    });
}

#[test]
fn conversions_and_throws() {
    with_names(|spellings| {
        assert!(matches!(
            spellings.intrinsic("$toNumber", IntrinsicPosition::Call),
            Some(Intrinsic::Conversion(Conversion::ToNumber))
        ));
        assert!(matches!(
            spellings.intrinsic("$throwTypeError", IntrinsicPosition::Call),
            Some(Intrinsic::Throw(ErrorKind::TypeError))
        ));
        assert!(matches!(
            spellings.intrinsic("$throwRangeError", IntrinsicPosition::Call),
            Some(Intrinsic::Throw(ErrorKind::RangeError))
        ));
        assert!(matches!(
            spellings.intrinsic("$ifAbruptCloseIterator", IntrinsicPosition::Call),
            Some(Intrinsic::IfAbruptCloseIterator)
        ));
        assert!(matches!(
            spellings.intrinsic("$undefined", IntrinsicPosition::Value),
            Some(Intrinsic::Undefined)
        ));
        assert!(spellings.intrinsic("$toNumber", IntrinsicPosition::Value).is_none());
        assert!(spellings.intrinsic("$undefined", IntrinsicPosition::Call).is_none());
    });
}

#[test]
fn symbol_keys() {
    with_names(|spellings| {
        assert_eq!(spellings.symbol_key("$$iterator"), Some(WellKnownSymbol::Iterator));
        assert_eq!(
            spellings.symbol_key("$$asyncIterator"),
            Some(WellKnownSymbol::AsyncIterator)
        );
        assert_eq!(spellings.symbol_key("$iterator"), None);
        assert_eq!(spellings.symbol_key("iterator"), None);
        assert_eq!(spellings.symbol_key("$$call"), None);
        assert!(spellings.intrinsic("$iterator", IntrinsicPosition::Member).is_none());
        assert!(spellings.intrinsic("$$iterator", IntrinsicPosition::Member).is_none());
    });
}

#[test]
fn native_call_is_no_intrinsic() {
    with_names(|spellings| {
        assert!(spellings.intrinsic("$cpp", IntrinsicPosition::Call).is_none());
        let mut native_call_count = 0;
        for name in table::intrinsic_names() {
            let found = table::intrinsic_of(name, IntrinsicPosition::Call);
            let Some(Intrinsic::NativeCall(kind)) = found else {
                continue;
            };
            native_call_count += 1;
            let spelling = [&b"$"[..], table::text_of_name(name)].concat();
            let spelling = spellings.atoms.intern(&spelling);
            let names = spellings.names;
            assert_eq!(find_native_call_kind(names, spelling), Some(kind));
            assert!(find_intrinsic(names, spelling, IntrinsicPosition::Call).is_none());
        }
        assert_eq!(native_call_count, 5);
    });
}

#[test]
fn native_call_kinds() {
    with_names(|spellings| {
        let kinds = [
            ("$cpp", NativeCallKind::Cpp),
            ("$rust", NativeCallKind::Rust),
            ("$newCppFunction", NativeCallKind::NewCppFunction),
            ("$newRustFunction", NativeCallKind::NewRustFunction),
        ];
        for (spelling, kind) in kinds {
            assert_eq!(spellings.native_call_kind(spelling), Some(kind), "{spelling}");
        }
    });
}
