pub const FILES: &[(&str, &str)] = &[
    ("array-search.ts", include_str!("array-search.ts")),
    ("array-sort.ts", include_str!("array-sort.ts")),
    ("array-traversal.ts", include_str!("array-traversal.ts")),
    ("decorators.ts", include_str!("decorators.ts")),
    ("json.ts", include_str!("json.ts")),
    ("written-lists.ts", include_str!("written-lists.ts")),
];

#[cfg(test)]
mod tests;
