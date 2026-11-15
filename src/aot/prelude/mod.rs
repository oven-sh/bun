pub const FILES: &[(&str, &str)] = &[
    ("array-search.ts", include_str!("array-search.ts")),
    ("array-sort.ts", include_str!("array-sort.ts")),
    ("decorators.ts", include_str!("decorators.ts")),
    (
        "iterator-consumers.ts",
        include_str!("iterator-consumers.ts"),
    ),
    ("rejected-imports.ts", include_str!("rejected-imports.ts")),
    ("test-files.ts", include_str!("test-files.ts")),
    ("written-lists.ts", include_str!("written-lists.ts")),
];

#[cfg(test)]
mod tests;
