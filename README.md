# Speedy - a fast web bundler & JavaScript runtime environment

Speedy bundles & transpiles JavaScript, TypeScript, and CSS. Speedy is probably the fastest bundler out today.

### Speed hacking

Here are some techniques Speedy uses to make your builds shockingly fast. Most are small wins. Some are big.

#### Compare comptime-known strings by nearest `(u64 || u32 || u16 || u8)`-sized integer

Parsers & lexers search source code for many tokens. For JavaScript, some of these include:

- `yield`
- `await`
- `for`
- `of`
- `in`
- `while`

You get the idea.

When you know the string you're looking for ahead of time, it's faster to compare multiple characters at a time than a single character.

<details>

<summary>Here's a function that does this. This is used in many places throughout the code.</summary>

```zig
pub fn eqlComptime(self: string, comptime alt: anytype) bool {
    switch (comptime alt.len) {
        0 => {
            @compileError("Invalid size passed to eqlComptime");
        },
        2 => {
            const check = std.mem.readIntNative(u16, alt[0..alt.len]);
            return self.len == alt.len and std.mem.readIntNative(u16, self[0..2]) == check;
        },
        1, 3 => {
            if (alt.len != self.len) {
                return false;
            }

            inline for (alt) |c, i| {
                if (self[i] != c) return false;
            }
            return true;
        },
        4 => {
            const check = std.mem.readIntNative(u32, alt[0..alt.len]);
            return self.len == alt.len and std.mem.readIntNative(u32, self[0..4]) == check;
        },
        6 => {
            const first = std.mem.readIntNative(u32, alt[0..4]);
            const second = std.mem.readIntNative(u16, alt[4..6]);

            return self.len == alt.len and first == std.mem.readIntNative(u32, self[0..4]) and
                second == std.mem.readIntNative(u16, self[4..6]);
        },
        5, 7 => {
            const check = std.mem.readIntNative(u32, alt[0..4]);
            if (self.len != alt.len or std.mem.readIntNative(u32, self[0..4]) != check) {
                return false;
            }
            const remainder = self[4..];
            inline for (alt[4..]) |c, i| {
                if (remainder[i] != c) return false;
            }
            return true;
        },
        8 => {
            const check = std.mem.readIntNative(u64, alt[0..alt.len]);
            return self.len == alt.len and std.mem.readIntNative(u64, self[0..8]) == check;
        },
        9...11 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);

            if (self.len != alt.len or first != std.mem.readIntNative(u64, self[0..8])) {
                return false;
            }

            inline for (alt[8..]) |c, i| {
                if (self[i + 8] != c) return false;
            }
            return true;
        },
        12 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);
            const second = std.mem.readIntNative(u32, alt[8..12]);
            return (self.len == alt.len) and first == std.mem.readIntNative(u64, self[0..8]) and second == std.mem.readIntNative(u32, self[8..12]);
        },
        13...15 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);
            const second = std.mem.readIntNative(u32, alt[8..12]);

            if (self.len != alt.len or first != std.mem.readIntNative(u64, self[0..8]) or second != std.mem.readIntNative(u32, self[8..12])) {
                return false;
            }

            inline for (alt[13..]) |c, i| {
                if (self[i + 13] != c) return false;
            }

            return true;
        },
        16 => {
            const first = std.mem.readIntNative(u64, alt[0..8]);
            const second = std.mem.readIntNative(u64, alt[8..15]);
            return (self.len == alt.len) and first == std.mem.readIntNative(u64, self[0..8]) and second == std.mem.readIntNative(u64, self[8..16]);
        },
        else => {
            @compileError(alt ++ " is too long.");
        },
    }
}
```

</details>

#### Skip decoding UTF-16 when safe

JavaScript engines represent strings as UTF-16 byte arrays. That means every character in a string occupies at least 2 bytes of memory. Most applications (and documents) use UTF-8, which uses at least 1 byte of memory.

Most JavaScript bundlers store JavaScript strings as UTF-16, either because the bundler is written in JavaScript, or to simplify the code.

It's much faster to reuse the memory from reading the contents of the JavaScript source and store the byte offset + length into the source file, than allocating a new string for each JavaScript string. This is safe when the string doesn't have a codepoint > 127, which mostly means `A-Za-z0-9` and punctuation. Most JavaScript strings don't use lots of emoji, so this saves from many tiny allocations.

#### CSS ~Parser~ Scanner

Speedy (currently) does not have a CSS Parser. But, it still processes CSS.

Most CSS processors work something like this:

1. Copy the CSS source code to a byte array
2. Iterate through every unicode codepoint, generating tokens (lexing)
3. Convert each token into an AST node (parsing)
4. Perform 1 or more passes over the AST. For tools like PostCSS, every plugin typically adds 1+ passes over the AST. (visiting)
5. Print the source code (printing)

Speedy's CSS Scanner scans, rewrites, and prints CSS in a single pass without generating an AST. It works like this:

1. Copy the CSS source code to a byte array
2. Iterate through every unicode codepoint, searching for lines starting with `@import` or property values with `url(`
3. For each url or import:
   1. Flush everything before the url or import
   2. Resolve the import URL
   3. Write the import URL
4. When end of file is reached, flush to disk.

Speedy's CSS Scanner is about 56x faster than PostCSS with the `postcss-import` and `postcss-url` plugins enabled (and sourcemaps disabled). On the other hand, auto-prefixing and minification won't work. Minifying whitespace is possible with some modifications, but minifiying CSS syntax correctly needs an AST.

This approach is fast, but not without tradeoffs!

Speedy's CSS Scanner is based on esbuild's CSS Lexer. Thank you @evanwallace.

#### Compile-time generated JavaScript Parsers

At the time of writing, there are 8 different comptime-generated variations of Speedy's JavaScript parser.

```zig
pub fn NewParser(
    comptime is_typescript_enabled: bool,
    comptime is_jsx_enabled: bool,
    comptime only_scan_imports_and_do_not_visit: bool,
) type {
```

When this is `false`, branches that only apply to parsing TypeScript are removed.

```zig
 comptime is_typescript_enabled: bool,
```

**Performance impact: +2%?**

```bash
❯ hyperfine "../../build/macos-x86_64/esdev node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" "../../esdev.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable" --min-runs=500
Benchmark #1: ../../build/macos-x86_64/esdev node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
  Time (mean ± σ):      25.1 ms ±   1.1 ms    [User: 20.4 ms, System: 3.1 ms]
  Range (min … max):    23.5 ms …  31.7 ms    500 runs

Benchmark #2: ../../esdev.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable
  Time (mean ± σ):      25.6 ms ±   1.3 ms    [User: 20.9 ms, System: 3.1 ms]
  Range (min … max):    24.1 ms …  39.7 ms    500 runs
'../../build/macos-x86_64/esdev node_modules/react-dom/cjs/react-dom.development.js --resolve=disable' ran
1.02 ± 0.07 times faster than '../../esdev.before-comptime-js-parser node_modules/react-dom/cjs/react-dom.development.js --resolve=disable'
```

When this is `false`, branches that only apply to parsing JSX are removed.

```zig
 comptime is_jsx_enabled: bool,
```

This is only used for application code when generating `node_modules.jsb`. This skips the visiting pass. It reduces parsing time by about 30%, but the source code cannot be printed without visiting. It's only useful for scanning `import` and `require`.

```zig
 comptime only_scan_imports_and_do_not_visit: bool,
```

At runtime, Speedy chooses the appropriate JavaScript parser to use based on the `loader`. In practical terms, this moves all the branches checking whether a parsing step should be run from inside several tight loops to just once, before parsing starts.

#### Max out per-process file handle limit automatically, leave file handles open.

**Performance impact: +5%**

It turns out, lots of time is spent opening and closing file handles. This is feature flagged off on Windows.

This also enabled a kqueue-based File System watcher on macOS. FSEvents, the more common macOS File System watcher uses kqueue internally to watch directories. Watching file handles is faster than directories. It was surprising to learn that none of the popular filesystem watchers for Node.js adjust the process ulimit, leaving many developers to deal with "too many open file handles" errors.

### Architecture

#### The Speedy Bundle Format

TODO: document

### Hot Module Reloading

Speedy's Hot Module Reloader uses a custom binary protocol that's around 8x more space efficient than other bundlers.

- File change notifications cost 9 bytes.
- Build metadata costs 13 bytes + length of the module path that was rebuilt + size of the built file.

For comparison, Vite's HMR implementation uses 104 bytes + length of the module path that was rebuilt (at the time of writing)

#### Instant CSS

When using `<link rel="stylesheet">`, Speedy HMR "just works", with zero configuration and without modifying HTML.

Here's how:

- On page load, CSS files are built per request
- When you make a change to a local CSS file, a file change notification is pushed over the websocket connection to the browser (HMR client)
- For the first update, instead of asking for a new file to build, it asks for a list of files that the file within the `<link rel="stylesheet">` imports, and any those `@import`, recursively. If `index.css` imports `link.css` and `link.css` imports `colors.css`, that list will include `index.css`, `link.css`, and `colors.css`.
- Preserving import order, the link tags are replaced in a single DOM update. This time, an additional query string flag is added `?noimport` which tells the Speedy CSS Scanner to remove any `@import` statements from the built CSS file.

While this approach today is fast, there are more scalable alternatives to large codebases worth considering (such as, a bundling format that supports loading individual files unbundled). This may change in the near future.
