use bun_core::strings;

const NAMES: [&str; 7] = [
    "array-search.ts",
    "array-sort.ts",
    "decorators.ts",
    "iterator-consumers.ts",
    "rejected-imports.ts",
    "test-files.ts",
    "written-lists.ts",
];

/// The name and the text of each file. Release builds embed the files compressed, in one frame.
pub fn files() -> impl Iterator<Item = (&'static str, &'static [u8])> {
    // In the order of `NAMES`. `emitCompressedEmbeds` in scripts/build/codegen.ts lists the same files in the same order.
    let all = bun_zstd::embed_compressed!(
        "aot/prelude.ts",
        concat!(
            include_str!("array-search.ts"),
            "\0",
            include_str!("array-sort.ts"),
            "\0",
            include_str!("decorators.ts"),
            "\0",
            include_str!("iterator-consumers.ts"),
            "\0",
            include_str!("rejected-imports.ts"),
            "\0",
            include_str!("test-files.ts"),
            "\0",
            include_str!("written-lists.ts"),
        )
        .as_bytes()
    );
    assert_eq!(strings::split(all, b"\0").count(), NAMES.len());
    NAMES.into_iter().zip(strings::split(all, b"\0"))
}

#[cfg(test)]
mod tests;
