// internal/core/scriptkind.go

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct ScriptKind(pub i32);

impl ScriptKind {
    pub const UNKNOWN: ScriptKind = ScriptKind(0);
    pub const JS: ScriptKind = ScriptKind(1);
    pub const JSX: ScriptKind = ScriptKind(2);
    pub const TS: ScriptKind = ScriptKind(3);
    pub const TSX: ScriptKind = ScriptKind(4);

    // Value 5 is reserved (formerly ScriptKindExternal).

    pub const JSON: ScriptKind = ScriptKind(6);

    // Value 7 is reserved (formerly ScriptKindDeferred).
}
