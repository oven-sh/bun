# Measurements (release builds, merge base 91e7e3b140 vs branch with in-place handler; final binaries /tmp/bun-release-{main,branch}, /tmp/bun-profile-{main,branch} built 04:24)

## Repro (brief): /tmp/m1/repro.css, outputs /tmp/m1/main.out, /tmp/m1/branch.out
main: 0 prefixed lines; `.e` prints `image-set("a.png" 1dppx, "b.png" 2dppx)` and does not bundle the files.
branch: .a -webkit-text-decoration, .b -webkit-text-emphasis, .c three longhand pairs (lightningcss folds to -webkit-text-emphasis: dot red), .d both var() copies, .e -webkit-image-set fallback + files inlined, .f bare.

## Binary size (size -A)
.text 81,665,765 -> 81,694,949 (+29,184 B); .rodata 22,614,988 -> 22,614,988 (+0); file 107,243,232 -> 107,276,000 (+32,768)

## 15 fixture sheets (test/js/bun/css/files), bun build
--target=browser: 3,155,382 -> 3,157,341 B (+1,959), 9 of 15 outputs change, +29 lines (all `-webkit-text-decoration`: 6 `underline dotted`, 21 `var(...)`, 2 `inherit`), 0 lines removed or changed (diff has only additions), 0 moved
--target=browser --minify: 2,732,962 -> 2,734,805 B (+1,843), 9 of 15
--target=bun: 0 of 15 outputs change (byte-identical), minified too
corpus: 21,020 blocks with declarations, 45,213 declarations, 138 family declarations in 128 blocks (6 with an !important family declaration), list-style-image: 0
handler work: other-list walks 128 (other list not empty in 1), `all` scans 10
lightningcss 1.32.0 on the same sheets: folds 0 longhands; deletes the first value of 9 `text-decoration: A; text-decoration: B` pairs; writes -webkit-text-decoration: var(--pico-text-decoration) twice in pico.css

## Instructions per declaration inside StyleSheet::minify ((count(10k) - count(5k)) / 5000, qemu -one-insn-per-tb -d exec)
declined:  zoom:1 863.1 -> 868.2 ; cursor:pointer 863.2 -> 870.6 ; --x:1 863.1 -> 868.5 ; display:block 928.1 -> 953.2 ; box-sizing:border-box 938.1 -> 963.1 ; color:red 850.0 -> 870.0 ; margin:0 823.0 -> 828.0 ; background:red 981.0 -> 990.0 ; top:0 702.0 -> 720.0 ; width:var(--w) 695.7 -> 702.7 ; color:var(--c) 1245.2 -> 1273.2
  display:block +25 = handler chain +11 (8 are the tag test of the new entry), TransitionHandler +5, minify loop +3, StyleRuleKey::new +3, TransformHandler +2, BorderHandler +1 (the Property tag is u16 after 254 -> 262 variants)
family:    text-decoration:none 863.2 -> 915.1 ; text-decoration:underline dotted 863.2 -> 911.2 ; underline wavy 863.2 -> 911.2 ; text-decoration:var(--x) 863.2 -> 1424.6 ; text-emphasis:dot red 863.2 -> 887.1 ; text-decoration-color:red 947.2 -> 872.2 ; list-style-image:none 863.2 -> 962.1

## Instructions per declaration inside StyleSheet::parse_with (same method)
color:red 2635.1 -> 2628.6 ; zoom:1 2597.9 -> 2595.4 (name table 251 -> 259 keys: no cost seen)
text-decoration:none 3039.7 -> 3316.3 ; underline dotted 3700.8 -> 4095.5 ; underline wavy red 4515.5 -> 4839.8 ; underline 2px 3797.4 -> 4883.9 ; text-emphasis:dot red 3563.6 -> 3892.9

## Allocations per declaration (mi_malloc entries, process-wide, (count(16k) - count(8k)) / 8000)
zoom:1 1 -> 1 ; --x:1 1 -> 1 ; display:block 0 -> 0 ; text-decoration:none 1 -> 0 ; underline wavy 1 -> 0 ; text-emphasis:dot red 1 -> 0 ; text-decoration:var(--x) 2 -> 3

## Type sizes (rustc -Zprint-type-sizes, dev profile)
TextDecorationHandler 32 B ; DeclarationHandler 6,848 -> 6,888 B ; FallbackHandler 32 -> 40 B ; Property 216 -> 216 B ; PropertyBitset 32 -> 64 B (ArrayBitSet<256,4> -> <512,8>, tags 254 -> 262) ; PropertyIdTag 2 B

## File syscalls (qemu -strace), 15 sheets: 1,916 -> 1,916..1,925 (run-to-run noise, main 1,915..1,916); sheet with list-style-image: image-set("a.png" 1x, "b.png" 2x): 77 -> 87 (opens 21 -> 23: the two files); list-style-image: url("a.png"): 82 -> 82

## Second pass / winners
exhaustive tests: 1,554 decoration blocks + 1,554 emphasis blocks, three browser kinds: 0 wrong on branch; main: 337 and 688 blocks wrong; buffered draft: 87 decoration blocks wrong and not stable
second sheet (merged --z rule or two-rule split): byte-equal to the first for all 3,108 blocks
fuzz: 4 seeds x 4 target lists x 20,000 random blocks (320,000): 0 differ after a re-parse pass, 0 differ after a merged-rule pass, 0 author-written prefixed declarations lost
merge flood `.a{text-decoration:underline dotted}.a{text-decoration:underline}` 2,000 / 4,000 rules: 7,244,402 -> 14,483,732 instructions in minify (ratio 2.00); main 6,813,020 -> 13,621,051; pass 2 adds the 1,000 / 2,000 `-webkit-text-decoration: underline` copies and nothing else
dedupe flood `.a{--xN:1}.bN{color:red}` 16k / 32k pairs: branch 113,373,707 -> 226,241,257 (ratio 2.00), all rules kept; main 115,999,965 -> 233,001,315 (ratio 2.01) but deletes every `.a` rule except the last (output 852,933 B against 1,577,800 B)

## Fail before / pass after
main release 91e7e3b140: test/js/bun/css/css.test.ts 103 fail of 1584; duplicate-declaration-merge-hang.test.ts 1 fail ("text-decoration produced another sheet")
branch debug (bun bd test, rebased on 6f58f6b894): css.test.ts 1510 pass, 69 skip, 5 todo, 0 fail; duplicate-declaration-merge-hang.test.ts 5 pass
also run on the branch debug build before the rebase: test/js/bun/css/ (2705 pass, 6 timeouts in css-fuzz and nested-selector-expansion that also time out under load on main), test/bundler/css/ + test/bundler/esbuild/css.test.ts (240 pass)
upstream assertions (test_text_decoration + test_text_emphasis, 77 ported): 67 verbatim, 2 verbatim as test.todo (@supports, #43421), 8 changed (7 folds, 1 position left), each with a comment
deviation comments in src: 13 (`Unlike lightningcss`), each one line, each with a test

## composes (CSS modules)
a.module.css `.foo { composes: bar from "./b.module.css"; -webkit-text-decoration: underline dotted }` + b.module.css `.bar { text-decoration: underline }`:
main: no diagnostic; branch: `error: The value of text-decoration in the class foo is undefined.` (exit code 0 on both). Same as main already does for `-webkit-transition` + `transition`.

## image-set strings
`list-style-image: image-set("missing.png" 1x)`: main leaves the string and prints `1dppx`; branch resolves it like url() (`Could not resolve: "missing.png"`), as main does for `background-image: image-set("missing.png" 1x)` and for `list-style-image: url("missing.png")`.
`list-style: image-set("missing.png" 1x) inside` is unchanged (unknown name).

## state to re-measure after the last code change (prefix_handler.rs lazy reset, author-written image prefixes): sizes, 6 declined declarations, type sizes, fixtures

# FINAL numbers (final code = 09b81e3aa4 diff applied on 91e7e3b140, release build in /tmp/wt-main, binaries /tmp/bun-release-final, /tmp/bun-profile-final, built 07:40)
size -A: .text 81,665,765 -> 81,695,205 (+29,440 B); .rodata 22,614,988 -> 22,614,988 (+0); file 107,243,232 -> 107,276,000 (+32,768)
fixtures: browser 3,155,382 -> 3,157,341 (+1,959 B), 9 of 15 change, +29 lines, 0 removed or changed; browser --minify 2,732,962 -> 2,734,805 (+1,843); bun: 0 of 15 change (also minified)
minify instructions per declaration, declined: zoom:1 863.1 -> 864.2 ; cursor:pointer 863.2 -> 866.6 ; --x:1 863.1 -> 865.5 ; display:block 928.1 -> 953.1 ; box-sizing:border-box 938.1 -> 963.1 ; color:red 850.0 -> 869.0 ; margin:0 823.0 -> 828.0 ; background:red 981.0 -> 990.0 ; top:0 702.0 -> 720.0 ; width:var(--w) 695.7 -> 702.5 ; color:var(--c) 1245.2 -> 1277.3
minify instructions per declaration, family: text-decoration:none 863.2 -> 915.1 ; underline dotted 863.2 -> 911.2 ; underline wavy 863.2 -> 911.2 ; text-decoration:var(--x) 863.2 -> 1424.6 ; text-emphasis:dot red 863.2 -> 887.1 ; text-decoration-color:red 947.2 -> 872.2 ; list-style-image:none 863.2 -> 971.1
parse instructions per declaration (measured on the 04:24 build, parse code unchanged since): color:red 2635.1 -> 2628.6 ; zoom:1 2597.9 -> 2595.4 ; text-decoration:none 3039.7 -> 3316.3 ; underline dotted 3700.8 -> 4095.5 ; underline wavy red 4515.5 -> 4839.8 ; underline 2px 3797.4 -> 4883.9 ; text-emphasis:dot red 3563.6 -> 3892.9
type sizes: TextDecorationHandler 32 B ; DeclarationHandler 6,848 -> 6,896 B ; FallbackHandler 32 -> 48 B ; Property 216 -> 216 B ; PropertyBitset 32 -> 64 B
css.test.ts on /tmp/bun-release-final: 1512 pass, 0 fail. On /tmp/bun-release-main: 103+ fail.
