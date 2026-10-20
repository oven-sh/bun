**Repro** (`bun build repro.css`, default browser target, `a.png` and `b.png` present)

```css
.a { text-decoration: underline wavy red; }
.b { text-emphasis: dot red; }
.c { text-emphasis-style: dot; text-emphasis-color: red; text-emphasis-position: over right; }
.d { text-decoration: var(--x); text-emphasis: var(--x); }
.e { list-style-image: image-set("a.png" 1x, "b.png" 2x); }
.f { text-decoration: underline; }
```

- Before: no prefixed line. `.e` prints `image-set("a.png" 1dppx, "b.png" 2dppx)` and does not bundle the files.
- After: `.a`, `.b` and `.d` get the `-webkit-` line of each declaration. `.c` gets three prefixed longhand lines (lightningcss 1.32.0 prints `-webkit-text-emphasis: dot red` and the position pair). `.e` gets the `-webkit-image-set()` line and prints `1x`. `.f` stays one line.

**How the handler decides**

- A declaration gets the prefixes that the targets need for its own feature, minus the prefixes that the author wrote for one of its longhands in the block (in either the normal or the `!important` list) since `all`.
- A color value gets the fallbacks of `CssColor::get_fallbacks`, unless an earlier unprefixed declaration of the block already sets each longhand. That declaration is the fallback the author wrote. `FallbackHandler` does the same for `color`.
- `text-decoration: underline` gets no prefix (as in lightningcss), unless the block has an earlier unprefixed declaration that sets a style or a color. In Safari up to 18.0 a line alone does not reset them, so the handler writes `-webkit-text-decoration: underline` too. Without this, `text-decoration: underline dotted; text-decoration: overline` draws a dotted overline in Safari 14.
- The handler reads the other list of the block and looks for `all` only when the list has a declaration for it: 128 of 21,020 blocks of the 15 sheets.

**Differences from lightningcss 1.32.0** (each has a one-line comment in the source and a test)

| lightningcss | this PR |
|---|---|
| folds longhands into the shorthand and writes the block at the end | writes each declaration where it is |
| keeps the last value of a property (`text-decoration: underline; text-decoration: underline dotted` loses the first) | keeps every value |
| replaces the prefixes that the author wrote with the ones that the targets need | keeps them, and adds no prefix that the author wrote in the block (parcel-bundler/lightningcss#977) |
| moves the thickness of `-webkit-text-decoration: underline 2px` to the unprefixed longhand | leaves a prefixed shorthand as it is |
| an unparsed longhand gets the prefixes of the shorthand | it gets the prefixes of its own feature |
| `text-emphasis-position: over left` gets no prefixed line | the prefixed name gets `over` |
| prints `none` for `text-decoration: red`, `text-decoration: ;`, `text-emphasis: red` | prints `red`, and leaves a value that browsers reject as it is |
| `list-style-image`: keeps the last image only, and replaces a `-webkit-image-set()` that the author wrote | keeps every image, and adds no `-webkit-image-set()` fallback after one that the author wrote |

`text-align` is not in this PR. Its part of the lightningcss handler lowers `start` and `end` to `left` and `right`. That is not a prefix, the default browsers read both keywords, and the row would type a very common name.

**Measurements** (release builds, merge base 91e7e3b140 and this PR on the same base)

- Instructions per declaration in `StyleSheet::minify`, from a `qemu-x86_64 -one-insn-per-tb -d exec` trace of one rule with 5,000 and with 10,000 copies: MEASURE_MINIFY
- The same in the parse function: MEASURE_PARSE
- Allocations per declaration: MEASURE_ALLOC
- Release binary (`size -A`): MEASURE_SIZE
- Type sizes: MEASURE_TYPES
- 15 fixture sheets (`test/js/bun/css/files`): MEASURE_FIXTURES
- Second pass: MEASURE_PASS2

**Other behavior changes**

- `StyleRule::is_duplicate` compared only the tag of a property. Two unknown names have one tag, so `.a{--x:1} .q{top:0} .a{--y:2}` lost `.a{--x:1}`, and `.e{cursor:pointer} .f{top:0} .e{vertical-align:middle}` lost the first `.e`. It also compared only the shorter part of the two lists, so `.c{color:red!important} .d{top:0} .c{color:blue}` lost the `!important` rule. It now compares the names and each list in full, and `hash_key` hashes an unknown name in place of its tag. #45814 has the same fix with the tag-only key, which makes a flood of same-selector rules quadratic. Whichever PR lands second takes this version.
- CSS modules: `composes` from another file now reports `The value of text-decoration in the class foo is undefined` when one file has `-webkit-text-decoration` and the other `text-decoration`, as it does on main for `-webkit-transition` and `transition`. The exit code stays 0.
- `@import "a.css" supports(-webkit-box-shadow: none)` printed the condition without its prefix. It prints the prefix now.
- `docs/bundler/css.mdx`: the `text-decoration` example shows the real output.

**Not in this PR**

- A `-webkit-` copy in one rule is not reset by a line alone in another rule, unless Bun merges the two rules. lightningcss has the same limit.
- `list-style`, `list-style-type` and `list-style-position` stay unknown names.
- #45814 and this PR each add rows to `properties_generated.rs` and one line to the handler chain. #45747 changes the chain. The second one to land has small conflicts there.

**Tests run**: `bun bd test test/js/bun/css/css.test.ts` (TESTS_CSS), `test/js/bun/css/duplicate-declaration-merge-hang.test.ts`, `test/js/bun/css/`, `test/bundler/css/`, `test/bundler/esbuild/css.test.ts`. A fuzz run of 320,000 random blocks under four browser lists: the output of a second pass is equal to the first for each one.
