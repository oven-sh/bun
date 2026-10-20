# usage: python3 make_body.py "<N concerns raised, M addressed sentence>"  → writes /tmp/draft/pr_body_final.md
import re, sys
self_review = sys.argv[1] if len(sys.argv) > 1 else "Self-reviewed: N concerns raised, M addressed."
body = """Part of #14167

### Problem
- `bun build` writes no `-webkit-text-decoration`, `-webkit-text-emphasis` or `-webkit-image-set()` fallback for `list-style-image`. Safari 14, a default target, drops `text-decoration: underline wavy red`. Chrome 80 draws no emphasis marks.
- The names have no row in `src/css/properties/properties_generated.rs`, so no handler in `src/css/declaration.rs` takes them.

### Fix
- Add 8 typed rows and the lightningcss value types. `TextDecorationHandler` (`src/css/properties/text.rs`) writes each declaration where it is, with the prefixes the targets need, the color fallbacks and the thickness longhand.
- `FallbackHandler` writes the `-webkit-image-set()` fallback of `list-style-image`.
- No declaration moves or disappears: on the 15 fixture sheets, `--target=bun` output is byte-identical and the browser target gains 29 lines.
- Verified: `test/js/bun/css/css.test.ts`, `duplicate-declaration-merge-hang.test.ts`, and the suites in Notes. SELF_REVIEW

### Background
- A handler is a stage of `DeclarationBlock::minify`. It takes a declaration and writes what Bun prints.
- Up to Safari 18.0, unprefixed `text-decoration` is the line alone and `-webkit-text-decoration` is the shorthand.
- Considered the lightningcss design, which buffers the block and folds longhands. On the 15 sheets the fold never fires and the buffer moves 31 declarations. A second pass changes its output.

### Downsides
- Longhands are not folded: `text-decoration-line` and `text-decoration-style` stay two declarations. 8 of 77 lightningcss expectations change.
- A typed declaration that no handler takes costs 928 to 953 instructions in `minify`. Release `.text` grows 29,440 bytes.
- `list-style-image: image-set("a.png" 1x)` now bundles the file as `url()` does. A missing file is a build error.
""".replace("SELF_REVIEW", self_review)
notes = open("/tmp/draft/pr_notes.md").read()
rep = {
 "MEASURE_MINIFY": """
  - no handler takes it: `zoom:1` 863.1 to 864.2, `cursor:pointer` 863.2 to 866.6, `--x:1` 863.1 to 865.5, `display:block` 928.1 to 953.1, `box-sizing:border-box` 938.1 to 963.1
  - another handler takes it: `color:red` 850.0 to 869.0, `margin:0` 823.0 to 828.0, `background:red` 981.0 to 990.0, `top:0` 702.0 to 720.0, `width:var(--w)` 695.7 to 702.5, `color:var(--c)` 1245.2 to 1277.3
  - this handler takes it: `text-decoration:none` 863.2 to 915.1, `text-decoration:underline dotted` 863.2 to 911.2, `text-decoration:var(--x)` 863.2 to 1424.6, `text-emphasis:dot red` 863.2 to 887.1, `text-decoration-color:red` 947.2 to 872.2, `list-style-image:none` 863.2 to 971.1
  - the 25 instructions of `display:block`: 8 are the tag test of the new chain entry. The others are in `TransitionHandler` (5), `StyleRuleKey::new` (3), the `minify` loop (3), the rest of the chain (3), `TransformHandler` (2) and `BorderHandler` (1). `Property` has 262 variants after 254, so its tag is 16 bits wide.""",
 "MEASURE_PARSE": "`color:red` 2635.1 to 2628.6, `zoom:1` 2597.9 to 2595.4 (the name table has 259 keys after 251), `text-decoration:none` 3039.7 to 3316.3, `text-decoration:underline dotted` 3700.8 to 4095.5, `text-decoration:underline wavy red` 4515.5 to 4839.8, `text-decoration:underline 2px` 3797.4 to 4883.9, `text-emphasis:dot red` 3563.6 to 3892.9",
 "MEASURE_ALLOC": "`zoom:1` 1 to 1, `display:block` 0 to 0, `text-decoration:none` 1 to 0, `text-emphasis:dot red` 1 to 0, `text-decoration:var(--x)` 2 to 3 (the handler clones the value, where `minify` moved it)",
 "MEASURE_SIZE": "`.text` 81,665,765 to 81,695,205 (+29,440 bytes), `.rodata` 22,614,988 to 22,614,988, file 107,243,232 to 107,276,000 (+32,768 bytes)",
 "MEASURE_TYPES": "`TextDecorationHandler` 32 bytes, `DeclarationHandler` 6,848 to 6,896, `FallbackHandler` 32 to 48, `Property` 216 to 216, `PropertyBitset` 32 to 64 (254 to 262 tags)",
 "MEASURE_FIXTURES": """
  - `--target=browser`: 3,155,382 to 3,157,341 bytes (+1,959). 9 of 15 outputs change. The diff is 29 added `-webkit-text-decoration` lines (6 `underline dotted`, 21 `var(...)`, 2 `inherit`), and no removed or changed line. With `--minify`: 2,732,962 to 2,734,805 bytes.
  - `--target=bun`: 0 of 15 outputs change, with and without `--minify`.
  - The sources have 138 declarations of these names in 128 of 21,020 blocks: 1 longhand and no `list-style-image`. lightningcss folds nothing there. It deletes the first value of 9 pairs such as `text-decoration: underline; text-decoration: underline dotted`.
  - File system calls for the 15 builds (`qemu -strace`): 1,916 before, 1,916 to 1,925 after (main gives 1,915 to 1,916 from run to run). A sheet with `image-set("a.png" 1x, "b.png" 2x)`: 77 to 87, for the two files.""",
 "MEASURE_PASS2": """
  - The three tests over every block of up to four declarations (1,554 blocks each) compare the values that three kinds of browser apply, before and after. They also minify each block a second time, after a merged rule or as two rules, and compare the bytes. Main fails 337 decoration blocks and 688 emphasis blocks.
  - `.a{text-decoration:underline dotted}.a{text-decoration:underline}` as 2,000 and 4,000 rules: 7,244,402 and 14,483,732 instructions in `minify` (ratio 2.00). The second pass adds the `-webkit-text-decoration: underline` copies and nothing else.
  - `.a{--xN:1}.bN{color:red}` as 16,000 and 32,000 pairs: 113,373,707 and 226,241,257 instructions (ratio 2.00). Main takes 115,999,965 and 233,001,315, and deletes every `.a` rule but the last.""",
 "TESTS_CSS": "1512 pass, 0 fail; main fails 103 of them",
}
for k, v in rep.items():
    assert k in notes, k
    notes = notes.replace(k, v)
full = body + "\n<details><summary>Notes</summary>\n\n" + notes.strip() + "\n\n</details>\n"
open("/tmp/draft/pr_body_final.md", "w").write(full)
vis = full.split("<details>")[0]
print("visible words:", len(re.findall(r"\S+", vis)), "em dashes:", full.count("\u2014") + full.count("\u2013"), "semicolons in visible:", vis.count(";"))
