## Zig

Syntax reminders:

- Private fields are fully supported in Zig with the `#` prefix. `struct { #foo: u32 };` makes a struct with a private field named `#foo`.
- Decl literals in Zig are recommended. `const decl: Decl = .{ .binding = 0, .value = 0 };`

Conventions:

- Prefer `@import` at the **bottom** of the file.
- It's `@import("bun")` not `@import("root").bun`
- You must be patient with the build.
