Part of #14167

### Problem
- `bun build` writes no `-webkit-text-decoration`, `-webkit-text-emphasis` or `-webkit-image-set()` fallback for `list-style-image`. Safari 14 drops `text-decoration: underline wavy red`. Chrome 80 draws no emphasis marks. Both are default targets.
- The names have no row in `src/css/properties/properties_generated.rs`, and no handler in `src/css/declaration.rs` takes them.

### Fix
- Add 8 typed rows and the lightningcss value types. `TextDecorationHandler` (`src/css/properties/text.rs`) writes each declaration where it is, with the prefixes the targets need, the color fallbacks and the thickness longhand.
- `FallbackHandler` writes the `-webkit-image-set()` fallback of `list-style-image`.
- Correct because no declaration moves and none is removed. On the 15 fixture sheets, `--target=bun` output is byte-identical and the browser target gains 29 lines.
- Verified: `test/js/bun/css/css.test.ts`, `duplicate-declaration-merge-hang.test.ts`, and the suites in Notes. Self-reviewed: N concerns raised, M addressed.

### Background
- A handler is a stage of `DeclarationBlock::minify`: it takes a declaration and writes what Bun prints.
- Up to Safari 18.0, unprefixed `text-decoration` is the line alone. `-webkit-text-decoration` is the full shorthand.
- Considered the lightningcss design: buffer the block and fold longhands into the shorthand. On the 15 sheets the fold fires 0 times, the buffer moves 31 declarations, and the second minify pass of a merged rule changes the output.

### Downsides
- Longhands are not folded: `text-decoration-line: underline; text-decoration-style: dotted` stays two declarations. 8 of 77 lightningcss expectations change.
- A typed declaration that no handler takes costs 928 to 953 instructions in the minify pass. Release `.text` grows 29,184 bytes.
- `list-style-image: image-set("a.png" 1x)` now bundles the file as `url()` does. A missing file is a build error.

<details><summary>Notes</summary>

NOTES_PLACEHOLDER

</details>
