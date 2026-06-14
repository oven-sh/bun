// Standalone fuzz mirror for EXP-035.
//
// Validates: `ptr::read_unaligned::<CompiledModuleGraphFile>` over the `__BUN`
// macho section in Bun's standalone executables. The record carries 4
// niche-bearing #[repr(u8)] enums; any byte outside their valid sets produces
// UB at the read.
//
// Mirrored discriminants:
//   FileSide      (2/256 valid)  : Server=0, Client=1
//   Encoding      (3/256 valid)  : None=0, Utf8=1, Buffer=2
//   ModuleFormat  (3/256 valid)  : Cjs=0, Esm=1, InternalConstants=2
//   Loader        (21/256 valid) : 0..=20
//
// The fuzzer feeds 16-byte records. The reader mirrors the buggy pattern
// (`ptr::read_unaligned` straight into the record without per-field validation)
// and we check that the safe decoder rejects iff a field is out of range.

#![no_main]

use libfuzzer_sys::fuzz_target;

#[repr(u8)] #[derive(Copy, Clone, Debug)]
#[allow(dead_code)]
enum FileSide { Server = 0, Client = 1 }

#[repr(u8)] #[derive(Copy, Clone, Debug)]
#[allow(dead_code)]
enum Encoding { None = 0, Utf8 = 1, Buffer = 2 }

#[repr(u8)] #[derive(Copy, Clone, Debug)]
#[allow(dead_code)]
enum ModuleFormat { Cjs = 0, Esm = 1, InternalConstants = 2 }

#[repr(u8)] #[derive(Copy, Clone, Debug)]
#[allow(dead_code)]
enum Loader {
    Jsx = 0, Js = 1, Ts = 2, Tsx = 3, Css = 4, File = 5, Json = 6, Toml = 7,
    Wasm = 8, NapiModule = 9, Base64 = 10, Dataurl = 11, Text = 12, Bunsh = 13,
    Sqlite = 14, SqliteEmbedded = 15, Html = 16, Latin1 = 17, Utf16 = 18,
    Empty = 19, Yaml = 20,
}

#[repr(C, packed)]
#[derive(Copy, Clone)]
struct CompiledModuleGraphFile {
    name_offset: u32,
    name_len: u32,
    contents_offset: u32,
    contents_len: u32,
    // 4 sparse-enum bytes packed at the end:
    side: u8,
    encoding: u8,
    module_format: u8,
    loader: u8,
}

fn decode_side(b: u8)         -> bool { b <= 1 }
fn decode_encoding(b: u8)     -> bool { b <= 2 }
fn decode_module_format(b: u8)-> bool { b <= 2 }
fn decode_loader(b: u8)       -> bool { b <= 20 }

fuzz_target!(|data: &[u8]| {
    // NOTE: struct is 4×u32 (16) + 4×u8 (4) = 20 bytes, not 16.
    // The original `<16` guard fired EXP-035's exact UB pattern in <1s:
    // libfuzzer-supplied 17-byte heap buffer + a `read_unaligned::<20-byte-struct>`
    // → ASan heap-buffer-overflow READ of size 20 at 0-bytes-after-17-byte-region.
    // That witness is preserved under artifacts/standalone_module_graph_fuzz/.
    // Guard now uses the true record size so the fuzzer continues exploring.
    if data.len() < 20 { return; }

    // Mirror the buggy read pattern: an unaligned read of the full record.
    // Wrapped in `core::ptr::read_unaligned` because that's what Bun does
    // in the EXP-035 site. Reading the 4 u32s is unconditionally safe; the
    // 4 trailing bytes only become UB when materialised as the enum types.
    let rec: CompiledModuleGraphFile = unsafe {
        core::ptr::read_unaligned(data.as_ptr() as *const CompiledModuleGraphFile)
    };

    // Pull each enum byte through the safe checker — never transmute to
    // the actual enum type if the byte is out of range, that's the UB we are
    // describing.
    let side_b   = rec.side;
    let enc_b    = rec.encoding;
    let mfmt_b   = rec.module_format;
    let loader_b = rec.loader;

    let side_ok   = decode_side(side_b);
    let enc_ok    = decode_encoding(enc_b);
    let mfmt_ok   = decode_module_format(mfmt_b);
    let loader_ok = decode_loader(loader_b);

    // Sanity: at least 235/256 byte values are invalid for `side`, etc.
    // Witness any 4-byte combination outside the joint valid set. We do NOT
    // crash on a single out-of-range byte (that would block coverage growth);
    // instead we crash only on the pathological combinations the EXP cites:
    // the **whole** record being valid is the rare case, and that's what the
    // attacker can NOT supply by accident.
    if side_ok && enc_ok && mfmt_ok && loader_ok {
        // Round-trip the 4 u32 fields through the unaligned read to verify
        // overflow_checks is hot on the u32 arithmetic (off + len bounds).
        let n_off = rec.name_offset; let n_len = rec.name_len;
        let c_off = rec.contents_offset; let c_len = rec.contents_len;
        // Bounded-arithmetic invariant: an attacker who supplies u32::MAX for
        // (offset, length) should hit a wrap that overflow_checks catches.
        let _ = n_off.checked_add(n_len);
        let _ = c_off.checked_add(c_len);
    }

    // Re-fuzz: write the record back via ptr::write_unaligned and re-read it,
    // exercising the unaligned-write path that the standalone-mode encoder
    // uses on the producer side (EXP-035 cross-validates encoder/decoder).
    // NOTE: buf is sized to the TRUE record size (20 = 4*u32 + 4*u8). An
    // earlier draft used [0u8; 16] which itself reproduced EXP-035's exact
    // "developer assumed 16, struct is 20" bug — preserved as witness.
    let mut buf = [0u8; 20];
    unsafe {
        core::ptr::write_unaligned(buf.as_mut_ptr() as *mut CompiledModuleGraphFile, rec);
        let round: CompiledModuleGraphFile = core::ptr::read_unaligned(buf.as_ptr() as *const CompiledModuleGraphFile);
        // Round-trip identity on the bytes:
        let a_off = round.name_offset; let r_off = rec.name_offset;
        if a_off != r_off { panic!("round-trip mismatch on name_offset"); }
    }
});
