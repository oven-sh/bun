//! Ported from src/test_runner/harness/fixtures.zig

use phf::phf_map;

pub static FIXTURES: phf::Map<&'static [u8], &'static [u8]> = phf_map! {
    b"package.json" => include_bytes!("./fixtures/package.json"),
    b"tsconfig.json" => include_bytes!("./fixtures/tsconfig.json"),
    b"simple-component.js" => include_bytes!("./fixtures/simple-component.js"),
    b"simple-component.tsx" => include_bytes!("./fixtures/simple-component.tsx"),
};





// ported from: src/test_runner/harness/fixtures.zig
