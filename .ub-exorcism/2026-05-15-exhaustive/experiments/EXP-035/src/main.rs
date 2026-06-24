// EXP-035: StandaloneModuleGraph read_unaligned::<CompiledModuleGraphFile>
// reads 4 sparse enums from a tampered Mach-O `__BUN` section.
//
// Mirror of src/standalone_graph/StandaloneModuleGraph.rs:230-246, 577-580:
//
//     let module: CompiledModuleGraphFile = unsafe {
//         core::ptr::read_unaligned(modules_list_base.add(i))
//     };
//
// `CompiledModuleGraphFile` is `#[repr(C)]` and contains four `#[repr(u8)]`
// enums with very sparse valid-byte sets:
//
//   * `FileSide`   — 2/256 valid
//   * `Encoding`   — 3/256 valid
//   * `ModuleFormat` — 3/256 valid
//   * `Loader`     — 21/256 valid
//
// Combined probability that a random 4-byte input lands on all-valid bytes:
//   (2 * 3 * 3 * 21) / 256^4 ≈ 8.8e-8
//
// Any single tampered byte outside the live discriminant set is immediate
// validity UB at the `read_unaligned` materialisation step — Miri eagerly
// validates enum tags when a value is *materialised*, not just used.
//
// Attack model: a tampered Bun-built standalone executable (`bun build
// --compile`). Any developer/CI runner that executes a downloaded
// standalone binary has reached this path.

#![allow(dead_code)]

// FileSide: 2/256 valid.
#[repr(u8)]
#[derive(Copy, Clone)]
enum FileSide {
    Client = 0,
    Server = 1,
}

// Encoding: 3/256 valid.
#[repr(u8)]
#[derive(Copy, Clone)]
enum Encoding {
    Utf8 = 0,
    Latin1 = 1,
    Utf16 = 2,
}

// ModuleFormat: 3/256 valid.
#[repr(u8)]
#[derive(Copy, Clone)]
enum ModuleFormat {
    Esm = 0,
    Cjs = 1,
    Internal = 2,
}

// Loader: 21/256 valid (mirroring the real enum's variant count).
#[repr(u8)]
#[derive(Copy, Clone)]
enum Loader {
    Js = 0,
    Ts = 1,
    Tsx = 2,
    Jsx = 3,
    Json = 4,
    Toml = 5,
    Wasm = 6,
    Napi = 7,
    Base64 = 8,
    Dataurl = 9,
    Text = 10,
    File = 11,
    Css = 12,
    Html = 13,
    Sqlite = 14,
    SqliteEmbedded = 15,
    BunSh = 16,
    SvgFragment = 17,
    SvgComponent = 18,
    BinaryString = 19,
    Default = 20,
}

// Mirror of CompiledModuleGraphFile — repr(C), 4 niche-bearing enums + pad.
#[repr(C)]
#[derive(Copy, Clone)]
struct CompiledModuleGraphFile {
    loader: Loader,
    encoding: Encoding,
    module_format: ModuleFormat,
    file_side: FileSide,
}

fn main() {
    // Craft a tampered byte sequence: first byte is 0xff (invalid for Loader,
    // which only accepts 0..=20). A real attacker would only need a single
    // bad byte anywhere in the record; we put it first so the failure mode
    // is unambiguous.
    let tampered: [u8; 4] = [0xff, 0x00, 0x00, 0x00];

    // Mirror the unsound load: read_unaligned materialises the value,
    // which triggers per-field enum-tag validation in Miri.
    let module: CompiledModuleGraphFile =
        unsafe { core::ptr::read_unaligned(tampered.as_ptr().cast::<CompiledModuleGraphFile>()) };

    // Touch all fields so a clever optimizer can't tell us the read didn't
    // happen. Miri's validity check fires at the read_unaligned line above
    // regardless.
    let _ = module.loader as u8;
    let _ = module.encoding as u8;
    let _ = module.module_format as u8;
    let _ = module.file_side as u8;

    println!("loaded module with loader byte {}", module.loader as u8);
}
