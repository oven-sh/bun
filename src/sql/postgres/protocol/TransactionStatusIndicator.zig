pub const TransactionStatusIndicator = enum(u8) {
    /// if idle (not in a transaction block)
    I = 'I',

    /// if in a transaction block
    T = 'T',

    /// if in a failed transaction block
    E = 'E',

    _,
};
