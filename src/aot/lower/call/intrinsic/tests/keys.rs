use super::{Probe, lower_runtime_module};
use crate::ir::{Opcode, PropertyKey, Reference, TypeTable, WellKnownSymbol};

fn has_text_key(probe: Probe<'_>, text: &str) -> bool {
    let keys = &probe.fragment.property_keys;
    let string = probe.fragment.strings.find(text.as_bytes());
    string.is_some_and(|string| keys.find(&PropertyKey::from_text(string)).is_some())
}

#[test]
fn private_member_key_is_engine_private() {
    let module = lower_runtime_module(
        "export function probePrivate(o: any) { return o.$data; }
export function probePublic(o: any) { return o.data; }
",
    );
    let private = module.function("probePrivate");
    let read = private.only(Opcode::PropGet);
    assert_eq!(read.operands(), [private.parameter(0)], "{private}");
    assert_eq!(read.keys(), [private.private_key("data")], "{private}");
    assert!(!has_text_key(private, "$data"), "{private}");

    let public = module.function("probePublic");
    let read = public.only(Opcode::PropGet);
    assert_eq!(read.keys(), [public.text_key("data")], "{public}");
}

#[test]
fn symbol_member_key_is_well_known_symbol() {
    let module = lower_runtime_module(
        "export function probeRead(o: any) { return o.$$iterator; }
export function probeCall(o: any) { return o.$$iterator(); }
",
    );
    let probe = module.function("probeRead");
    let iterator = probe.symbol_key(WellKnownSymbol::Iterator);
    let read = probe.only(Opcode::PropGet);
    assert_eq!(read.operands(), [probe.parameter(0)], "{probe}");
    assert_eq!(read.keys(), [iterator], "{probe}");

    let probe = module.function("probeCall");
    let read = probe.only(Opcode::PropGet);
    assert_eq!(read.keys(), [iterator], "{probe}");
    let call = probe.only(Opcode::Call);
    assert_eq!(call.operands(), [read.id(), probe.parameter(0)], "{probe}");
    assert_eq!(call.keys(), [iterator], "{probe}");
    assert!(!has_text_key(probe, "$$iterator"), "{probe}");
}

#[test]
fn literal_and_pattern_keys_share_private_name() {
    let module = lower_runtime_module(
        "export function probeLiteral(v: any) { return { $data: v }; }
export function probePattern(o: any) { const { $data: data } = o; return data; }
",
    );
    let literal = module.function("probeLiteral");
    let private = literal.private_key("data");
    let created = literal.only(Opcode::NewObject);
    let [Reference::Layout(layout)] = created.references()[..] else {
        panic!("an allocation names its layout:\n{literal}");
    };
    let mut layouts = literal.fragment.layouts.iter();
    let definition = layouts.find(|(id, _)| *id == layout);
    let (_, definition) = definition.expect("the fragment defines the layout of its literal");
    let mut keys = definition.fields.iter().map(|field| field.key);
    assert!(keys.any(|key| key == Some(private)), "{definition:?}");

    let pattern = module.function("probePattern");
    assert_eq!(pattern.only(Opcode::PropGet).keys(), [private], "{pattern}");
    assert!(!has_text_key(pattern, "$data"), "{pattern}");
}

#[test]
fn literal_key_is_engine_private() {
    let module = lower_runtime_module(
        "export function probeGet(o: any) { return $getByIdDirectPrivate(o, \"data\"); }
export function probePut(o: any, v: any) { $putByIdDirectPrivate(o, \"data\", v); }
export function probePublic(o: any) { return $getByIdDirect(o, \"data\"); }
",
    );
    let get = module.function("probeGet");
    let private = get.private_key("data");
    let read = get.only(Opcode::GetOwnProperty);
    assert_eq!(read.operands(), [get.parameter(0)], "{get}");
    assert_eq!(read.keys(), [private], "{get}");

    let put = module.function("probePut");
    let claimed = put.only_demanded_conversion();
    assert_eq!(claimed.operands(), [put.parameter(0)], "{put}");
    assert_eq!(claimed.types(), [TypeTable::OBJECT], "{put}");
    let define = put.only(Opcode::PropDefine);
    assert_eq!(define.operands(), [claimed.id(), put.parameter(1)], "{put}");
    assert_eq!(define.keys(), [private], "{put}");

    let public = module.function("probePublic");
    let read = public.only(Opcode::GetOwnProperty);
    assert_eq!(read.keys(), [public.text_key("data")], "{public}");
}
