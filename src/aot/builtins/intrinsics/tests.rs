use super::*;
use crate::builtins::table::{Conversion, ErrorKind};
use crate::ir::Opcode;
use IntrinsicPosition::{Call, Member, Value};
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

macro_rules! assert_found {
    ($spellings:ident, $($spelling:literal, $position:ident => $found:pat,)*) => {$(
        let found = $spellings.intrinsic($spelling, $position);
        assert!(matches!(found, Some($found)), "{}: {found:?}", $spelling);
    )*};
}

#[track_caller]
fn assert_absent(spellings: &Spellings<'_, '_>, absent: &[(&str, IntrinsicPosition)]) {
    for &(spelling, position) in absent {
        let found = spellings.intrinsic(spelling, position);
        assert!(found.is_none(), "{spelling}: {found:?}");
    }
}

#[test]
fn resolves_private_spellings_by_position() {
    with_names(|spellings| {
        assert_found!(spellings,
            "$toLength", Call => Intrinsic::Operation(Opcode::ToLength),
            "$isObject", Call => Intrinsic::IsObject,
            "$isCallable", Call => Intrinsic::IsCallable,
            "$call", Member => Intrinsic::Call { is_never_inlined: false },
            "$callNoInline", Call => Intrinsic::Call { is_never_inlined: true },
        );
        assert_eq!(
            spellings.native_call_kind("$cpp"),
            Some(NativeCallKind::Cpp)
        );
    });
}

#[test]
fn rejects_other_positions_and_spellings() {
    with_names(|spellings| {
        let absent = [
            ("$isObject", Member),
            ("$isObject", Value),
            ("isObject", Call),
            ("$$isObject", Call),
            ("$notAnIntrinsic", Call),
        ];
        assert_absent(spellings, &absent);
        assert_eq!(spellings.native_call_kind("$isObject"), None);
        assert_eq!(spellings.native_call_kind("cpp"), None);
    });
}

#[test]
fn position_selects_entry() {
    with_names(|spellings| {
        assert_found!(spellings,
            "$isArray", Call => Intrinsic::Builtin(table::BuiltinId::ArrayIsArray),
            "$isArray", Value => Intrinsic::Builtin(table::BuiltinId::LinkTimeConstantIsArray),
        );
    });
}

#[test]
fn conversions_and_throws() {
    with_names(|spellings| {
        assert_found!(spellings,
            "$toNumber", Call => Intrinsic::Conversion(Conversion::ToNumber),
            "$throwTypeError", Call => Intrinsic::Throw(ErrorKind::TypeError),
            "$throwRangeError", Call => Intrinsic::Throw(ErrorKind::RangeError),
            "$ifAbruptCloseIterator", Call => Intrinsic::IfAbruptCloseIterator,
            "$undefined", Value => Intrinsic::Undefined,
        );
        assert_absent(spellings, &[("$toNumber", Value), ("$undefined", Call)]);
    });
}

#[test]
fn symbol_keys() {
    with_names(|spellings| {
        assert_eq!(
            spellings.symbol_key("$$iterator"),
            Some(WellKnownSymbol::Iterator)
        );
        assert_eq!(
            spellings.symbol_key("$$asyncIterator"),
            Some(WellKnownSymbol::AsyncIterator)
        );
        assert_eq!(spellings.symbol_key("$iterator"), None);
        assert_eq!(spellings.symbol_key("iterator"), None);
        assert_eq!(spellings.symbol_key("$$call"), None);
        let absent = [("$iterator", Member), ("$$iterator", Member)];
        assert_absent(spellings, &absent);
    });
}

#[test]
fn native_call_is_no_intrinsic() {
    with_names(|spellings| {
        assert_absent(spellings, &[("$cpp", Call)]);
        let mut native_call_count = 0;
        for name in table::intrinsic_names() {
            let found = table::intrinsic_of(name, Call);
            let Some(Intrinsic::NativeCall(kind)) = found else {
                continue;
            };
            native_call_count += 1;
            let spelling = [&b"$"[..], table::text_of_name(name)].concat();
            let spelling = spellings.atoms.intern(&spelling);
            let names = spellings.names;
            assert_eq!(find_native_call_kind(names, spelling), Some(kind));
            assert!(find_intrinsic(names, spelling, Call).is_none());
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
            let found = spellings.native_call_kind(spelling);
            assert_eq!(found, Some(kind), "{spelling}");
        }
    });
}
