/// Represents JavaScript runtime value types
pub const JSRuntimeType = enum(u16) {
    Nothing = 0x0,
    Function = 0x1,
    Undefined = 0x2,
    Null = 0x4,
    Boolean = 0x8,
    AnyInt = 0x10,
    Number = 0x20,
    String = 0x40,
    Object = 0x80,
    Symbol = 0x100,
    BigInt = 0x200,

    _,
};
