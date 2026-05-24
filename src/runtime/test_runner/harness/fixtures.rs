//! Ported from src/test_runner/harness/fixtures.zig

use phf::phf_map;

// TODO(port): Zig source has a duplicate `"simple-component.tsx"` entry (lines 5-6); phf rejects
// duplicate keys at compile time so the second one is dropped here. Verify upstream intent.
pub static FIXTURES: phf::Map<&'static [u8], &'static [u8]> = phf_map! {
    b"package.json" => include_bytes!("./fixtures/package.json"),
    b"tsconfig.json" => include_bytes!("./fixtures/tsconfig.json"),
    b"simple-component.js" => include_bytes!("./fixtures/simple-component.js"),
    b"simple-component.tsx" => include_bytes!("./fixtures/simple-component.tsx"),
};





// ported from: src/test_runner/harness/fixtures.zig
