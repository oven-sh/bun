## Zig

Syntax reminders:

- Private fields are fully supported in Zig with the `#` prefix. `struct { #foo: u32 };` makes a struct with a private field named `#foo`.
- Decl literals in Zig are recommended. `const decl: Decl = .{ .binding = 0, .value = 0 };`

Conventions:

- Prefer `@import` at the **bottom** of the file, but the auto formatter will move them so you don't need to worry about it.
- **Never** use `@import()` inline inside of functions. **Always** put them at the bottom of the file or containing struct. Imports in Zig are free of side-effects, so there's no such thing as a "dynamic" import.
- You must be patient with the build.
