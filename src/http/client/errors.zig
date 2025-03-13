pub const InitError = error{
    FailedToOpenSocket,
    LoadCAFile,
    InvalidCAFile,
    InvalidCA,
};
pub const HTTPCertError = struct {
    error_no: i32 = 0,
    code: [:0]const u8 = "",
    reason: [:0]const u8 = "",
};
