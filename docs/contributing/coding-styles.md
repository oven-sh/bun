Bun mainly uses Zig, C++, and Typescirpt for its codebase.
Establishing a consistent coding style is important for the readability of the codebase.
Before commiting code, please make sure to follow the coding style guidelines below.

# Zig

## Formatting

- Use `bun run zig:fmt` to format your code.
- Formatting code through Visual Studio Code [Zig extension](https://marketplace.visualstudio.com/items?itemName=ziglang.vscode-zig) is also recommended.
- When importing code from other zig files, use the following syntax:

```zig
const foo = @import("foo.zig"); // DO NOT use `const foo = @import("./foo.zig");
```

- `@import` statement has to be at the top of the file. This is VERY IMPORTANT for cod readibility. The priority order is as follows:

```zig
const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const completions = @import("root").completions;

const c = std.c;
const mem = std.mem;
// ...

const Target = builtin.Target;
const zigVersion = builtin.zigVersion;
// ...

const allocators = bun.allocators;
const Environment = bun.Environment;
// and so on ...
```

## Naming Conventions

The [Zig language documentation](https://ziglang.org/documentation/master/#Names) provides a comprehensive guide on naming conventions.
The following are some of the key points:

- Use `snake_case` for variable names.
- Use `CamelCase` for type names.
- Use `TitleCase` for types or returning type.
  Read the [Zig naming conventions](https://ziglang.org/documentation/master/#Names) for more details.

## Modules / Import

Zig's `@import` to import code from other files. Use the following folder structure to organize your code:

```
src/
  foo.zig
  bar.zig
  bar/
    baz.zig
```

In the above example, `foo.zig` does not have any child modules, so it can be imported directly. However, `bar.zig` has a child module `baz.zig`, so `baz` should be imported by `bar.zig`:

```zig
// bar.zig
const baz = @import("bar/baz.zig");
```

When importing `baz.zig` from other files, use the following syntax:

```zig
// other_files.zig
const baz = @import("root").bar.baz;
```

DO NOT import using path like `const baz = @import("../bar/baz.zig");` as it will break the import path when the file is moved.

### Rationale

- This approach makes it easier to move files around without breaking the import path.
- It also makes it easier to understand the file structure of the project.
- It is consistent with the Zig standard library.
- It is consistent with the Zig community's best practices.
- This shows the code hierarchy more clearly.
  [Zig's std library](https://github.com/ziglang/zig/tree/master/lib/std) uses the same approach and shows the best practice.

# C++

## Formatting

Run `bun run clang-format` to format your code. `.clang-format` is provided under `src` directory.

## Linting

Run `bun run clang-tidy` to lint your code. `.clang-tidy` is provided under the root directory.

# Typescript

## Formatting

Run `bun run prettier` to format your code. `.prettierrc` is provided under the root directory.

## Linting

Run `bun run lint` or `bun run lint:fix` to lint your code. Bun uses [oxlint](https://oxc.rs/docs/guide/usage/linter) for linting. `.oxlint` is provided under the root directory.
