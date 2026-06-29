bun_core::comptime_string_map! {
    pub static FIXTURES: &'static [u8] = {
        b"package.json" => include_bytes!("./fixtures/package.json"),
        b"tsconfig.json" => include_bytes!("./fixtures/tsconfig.json"),
        b"simple-component.js" => include_bytes!("./fixtures/simple-component.js"),
        b"simple-component.tsx" => include_bytes!("./fixtures/simple-component.tsx"),
    };
}
