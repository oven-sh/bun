// translate-c is unable to translate the unsuffixed windows functions
// like `SetCurrentDirectory` since they are defined with an odd macro
// that translate-c doesn't handle.
//
//     #define SetCurrentDirectory __MINGW_NAME_AW(SetCurrentDirectory)
//
// In these cases, it's better to just reference the underlying function
// directly: SetCurrentDirectoryW. To make the error better, a post
// processing step is applied to the translate-c file.

// TODO(port): standalone build-time codegen binary — uses std::env / std::fs::{read,write}
// directly (PORTING.md bans std::fs for runtime code). The Zig original also calls std.fs
// directly (not bun.sys) since this never links into the runtime. Either keep as-is
// for build tooling, or swap to bun_sys::File::read_from / bun_sys::File::write_file.

// ported from: src/codegen/process_windows_translate_c.zig
