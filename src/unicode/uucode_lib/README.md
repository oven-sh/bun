# uucode (Micro/µ Unicode)

A fast and flexible unicode library, fully configurable at build time.

## Basic usage

```zig
const uucode = @import("uucode");

var cp: u21 = undefined;

//////////////////////
// `get` properties

cp = 0x2200; // ∀
uucode.get(.general_category, cp) // .symbol_math
uucode.TypeOf(.general_category) // uucode.types.GeneralCategory

cp = 0x03C2; // ς
uucode.get(.simple_uppercase_mapping, cp) // U+03A3 == Σ

cp = 0x21C1; // ⇁
uucode.get(.name, cp) // "RIGHTWARDS HARPOON WITH BARB DOWNWARDS"

// Many of the []const u21 fields need a single item buffer passed to `with`:
var buffer: [1]u21 = undefined;
cp = 0x00DF; // ß
uucode.get(.uppercase_mapping, cp).with(&buffer, cp) // "SS"

//////////////////////
// `getAll` to get a group of properties for a code point together.

cp = 0x03C2; // ς

// The first argument is the name/index of the table.
const data = uucode.getAll("0", cp);

data.simple_uppercase_mapping // U+03A3 == Σ
data.general_category // .letter_lowercase
@TypeOf(data) == uucode.TypeOfAll("0")

//////////////////////
// utf8.Iterator

var it = uucode.utf8.Iterator.init("😀😅😻👺");
it.next(); // 0x1F600
it.i; // 4 (bytes into the utf8 string)
it.peek(); // 0x1F605
it.next(); // 0x1F605
it.next(); // 0x1F63B
it.next(); // 0x1F47A

//////////////////////
// grapheme.Iterator / grapheme.utf8Iterator

var it = uucode.grapheme.utf8Iterator("👩🏽‍🚀🇨🇭👨🏻‍🍼")

// (which is equivalent to:)
var it = uucode.grapheme.Iterator(uccode.utf8.Iterator).init(.init("👩🏽‍🚀🇨🇭👨🏻‍🍼"));

// `nextCodePoint` advances one code point at a time, indicating a new grapheme
// with `is_break = true`.
it.nextCodePoint(); // { .code_point = 0x1F469; .is_break = false } // 👩
it.i; // 4 (bytes into the utf8 string)

it.peekCodePoint(); // { .code_point = 0x1F3FD; .is_break = false } // 🏽
it.nextCodePoint(); // { .code_point = 0x1F3FD; .is_break = false } // 🏽
it.nextCodePoint(); // { .code_point = 0x200D; .is_break = false } // Zero width joiner
it.nextCodePoint(); // { .code_point = 0x1F680; .is_break = true } // 🚀

// `nextGrapheme` advances until the start of the next grapheme cluster
const result = it.nextGrapheme(); // { .start = 15; .end = 23 }
it.i; // "👩🏽‍🚀🇨🇭".len
str[result.?.start..result.?.end]; // "🇨🇭"

const result = it.peekGrapheme();
str[result.?.start..result.?.end]; // "👨🏻‍🍼"

//////////////////////
// grapheme.isBreak

var break_state: uucode.grapheme.BreakState = .default;

var cp1: u21 = 0x1F469; // 👩
var cp2: u21 = 0x1F3FD; // 🏽
uucode.grapheme.isBreak(cp1, cp2, &break_state); // false

cp1 = cp2;
cp2 = 0x200D; // Zero width joiner
uucode.grapheme.isBreak(cp1, cp2, &break_state); // false

cp1 = cp2;
cp2 = 0x1F680; // 🚀
// The combined grapheme cluster is 👩🏽‍🚀 (woman astronaut)
uucode.grapheme.isBreak(cp1, cp2, &break_state); // false

cp1 = cp2;
cp2 = 0x1F468; // 👨
uucode.grapheme.isBreak(cp1, cp2, &break_state); // true

//////////////////////
// x.grapheme.wcwidth{,Next,Remaining} / x.grapheme.utf8Wcwidth

const str = "ò👨🏻‍❤️‍👨🏿_";
var it = uucode.grapheme.utf8Iterator(str);

// Requires the `wcwidth` builtin extension (see below)
uucode.x.grapheme.wcwidth(it); // 1 for 'ò'

uucode.x.grapheme.wcwidthNext(&it); // 1 for 'ò'
const result = it.peekGrapheme();
str[result.?.start..result.?.end]; // "👨🏻‍❤️‍👨🏿"

uucode.x.grapheme.wcwidthRemaining(&it); // 3 for "👨🏻‍❤️‍👨🏿_"

uucode.x.grapheme.utf8Wcwidth(str); // 4 for the whole string
```

See [src/config.zig](./src/config.zig) for the names of all fields.

## Configuration

Only include the Unicode fields you actually use:

```zig
// In `build.zig`:
if (b.lazyDependency("uucode", .{
    .target = target,
    .optimize = optimize,
    .fields = @as([]const []const u8, &.{
        "name",
        "general_category",
        "case_folding_simple",
        "is_alphabetic",
        // ...
    }),
})) |dep| {
    step.root_module.addImport("uucode", dep.module("uucode"));
}
```

### Multiple tables

Fields can be split into multiple tables using `field_0` through `fields_9`, to optimize how fields are stored and accessed (with no code changes needed).

```zig
// In `build.zig`:
if (b.lazyDependency("uucode", .{
    .target = target,
    .optimize = optimize,
    .fields_0 = @as([]const []const u8, &.{
        "general_category",
        "case_folding_simple",
        "is_alphabetic",
    }),
    .fields_1 = @as([]const []const u8, &.{
        // ...
    }),
    .fields_2 = @as([]const []const u8, &.{
        // ...
    }),
    // ... `fields_3` to `fields_9`
})) |dep| {
    step.root_module.addImport("uucode", dep.module("uucode"));
}
```

### Builtin extensions

`uucode` includes builtin extensions that add derived properties. Use `extensions` or `extensions_0` through `extensions_9` to include them:

```zig
// In `build.zig`:
if (b.lazyDependency("uucode", .{
    .target = target,
    .optimize = optimize,
    .extensions = @as([]const []const u8, &.{
        "wcwidth",
    }),
    .fields = @as([]const []const u8, &.{
        // Make sure to also include the extension's fields here:
        "wcwidth_standalone",
        "wcwidth_zero_in_grapheme",
        ...
        "general_category",
    }),
})) |dep| {
    step.root_module.addImport("uucode", dep.module("uucode"));
}

// In your code:
uucode.get(.wcwidth_standalone, 0x26F5) // ⛵ == 2
```

See [src/x/config.x.zig](src/x/config.x.zig) for the full list of builtin extensions.

### Advanced configuration

```zig
///////////////////////////////////////////////////////////
// In `build.zig`:

b.dependency("uucode", .{
    .target = target,
    .optimize = optimize,
    .build_config_path = b.path("src/build/uucode_config.zig"),

    // Alternatively, use a string literal:
    //.@"build_config.zig" = "..."
})

///////////////////////////////////////////////////////////
// In `src/build/uucode_config.zig`:

const std = @import("std");
const config = @import("config.zig");

// Use `config.x.zig` for builtin extensions:
const config_x = @import("config.x.zig");

const d = config.default;
const wcwidth = config_x.wcwidth;

// Or build your own extension:
const emoji_odd_or_even = config.Extension{
    .inputs = &.{"is_emoji"},
    .compute = &computeEmojiOddOrEven,
    .fields = &.{
        .{ .name = "emoji_odd_or_even", .type = EmojiOddOrEven },
    },
};

fn computeEmojiOddOrEven(
    allocator: std.mem.Allocator,
    cp: u21,
    data: anytype,
    backing: anytype,
    tracking: anytype,
) std.mem.Allocator.Error!void {
    // allocator is an ArenaAllocator, so don't worry about freeing
    _ = allocator;

    // backing and tracking are only used for slice types (see
    // src/build/test_build_config.zig for examples).
    _ = backing;
    _ = tracking;

    if (!data.is_emoji) {
        data.emoji_odd_or_even = .not_emoji;
    } else if (cp % 2 == 0) {
        data.emoji_odd_or_even = .even_emoji;
    } else {
        data.emoji_odd_or_even = .odd_emoji;
    }
}

// Types must be marked `pub`
pub const EmojiOddOrEven = enum(u2) {
    not_emoji,
    even_emoji,
    odd_emoji,
};

// Configure tables with the `tables` declaration.
// The only required field is `fields`, and the rest have reasonable defaults.
pub const tables = [_]config.Table{
    .{
        // Optional name, to be able to `getAll("foo")` rather than e.g.
        // `getAll("0")`
        .name = "foo",

        // A two stage table can be slightly faster if the data is small. The
        // default `.auto` will pick a reasonable value, but to get the
        // absolute best performance run benchmarks with `.two` or `.three`
        // on realistic data.
        .stages = .three,

        // The default `.auto` value decide whether the final data stage struct
        // should be a `packed struct` (.@"packed") or a regular Zig `struct`.
        .packing = .unpacked,

        .extensions = &.{
            emoji_odd_or_even,
            wcwidth,
        },

        .fields = &.{
            // Don't forget to include the extension's fields here.
            emoji_odd_or_even.field("emoji_odd_or_even"),
            wcwidth.field("wcwidth_standalone"),
            wcwidth.field("wcwidth_zero_in_grapheme"),

            // See `src/config.zig` for everything that can be overriden.
            // In this example, we're embedding 15 bytes into the `stage3` data,
            // and only names longer than that need to use the `backing` slice.
            d.field("name").override(.{
                .embedded_len = 15,
                .max_offset = 986096, // run once to get the correct number
            }),

            d.field("general_category"),
            d.field("block"),
            // ...
        },
    },
};

// Turn on debug logging:
pub const log_level = .debug;

///////////////////////////////////////////////////////////
// In your code:

const uucode = @import("uucode");

uucode.get(.wcwidth_standalone, 0x26F5) // ⛵ == 2

uucode.get(.emoji_odd_or_even, 0x1F34B) // 🍋 == .odd_emoji

```

## Code architecture

The architecture works in a few layers:

- Layer 1 (`src/build/Ucd.zig`): Parses the Unicode Character Database (UCD).
- Layer 2 (`src/build/tables.zig`): Generates table data written to a zig file.
- Layer 3 (`src/root.zig`): Exposes methods to fetch information from the built tables.

## History and acknowledgments

`uucode` began out of work on the [Ghostty terminal](https://ghostty.org/) on [an issue to upgrade dependencies](https://github.com/ghostty-org/ghostty/issues/5694), where the experience modifying [zg](https://codeberg.org/atman/zg/) gave the confidence to build a fresh new library.

`uucode` builds upon the Unicode performance work done in Ghostty, [as outlined in this excellent Devlog](https://mitchellh.com/writing/ghostty-devlog-006). The 3-stage lookup tables, as mentioned in that Devlog, come from [this article](https://here-be-braces.com/fast-lookup-of-unicode-properties/).

## License

`uucode` is available under an MIT License. See [./LICENSE.md](./LICENSE.md) for the license text and an index of licenses for code used in the repo.

## Resources

See [./RESOURCES.md](./RESOURCES.md) for a list of resources used to build `uucode`.
