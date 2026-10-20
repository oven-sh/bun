# Handoff: text-decoration / text-emphasis / list-style-image handler (session cf2a0e8e)

State on 2026-10-20. No PR was opened. The self-review returned `supersede` / `wanted-in-a-different-shape` (rework).

## Where the work is

- Code: `refs/backup/robobun-cf2a0e8e-css-text-decoration` = 09b81e3aa4, six commits on origin/main 6f58f6b894.
  `git fetch origin refs/backup/robobun-cf2a0e8e-css-text-decoration && git checkout FETCH_HEAD`
- Notes (this file, measurements, PR body draft, scripts, both review results): `refs/backup/robobun-cf2a0e8e-notes`.

## What the branch does

- 8 typed rows (text-decoration, -line, -style, -thickness, text-emphasis, -style, -position, list-style-image) and the lightningcss value types.
- `TextDecorationHandler` (src/css/properties/text.rs): in place, no buffer, no fold. Prefixes that the targets need and the author did not write, color fallbacks, thickness split, percent to calc().
- `stale` rule: a line-only `text-decoration` gets the `-webkit-` copy after an unprefixed declaration that sets a style or a color (Safari up to 18.0 reads the unprefixed name as the line alone).
- `FallbackHandler` arm for `list-style-image` (image-set fallback).
- Riders: `StyleRule::is_duplicate` / `hash_key` (names of unknown properties, each list in full), `@import supports()` prefix print, docs example.
- Tests: css.test.ts (three describe blocks, three 1,554-block oracle tests), duplicate-declaration-merge-hang.test.ts floods.
- Results: css.test.ts 1512 pass on the branch, 103 fail on main 91e7e3b140. Measurements are in measurements.md.

## Why it was not opened (self-review, verified citations)

- Size: +3,108 lines. `.claude/docs/landing-prs.md:67`: one concern per PR, diff size is grounds for changes-requested. Largest css-only merge so far is +391.
- Riders duplicate open PRs: #33684 (duplicate-rule fix at `PropertyId::eq`/`Hash`, fixes #45730 and #44704), #38589 (supports() prefix print, same `flag.to_css(d)?` line).
- The handler's rule "keep author-written prefixes, no buffer, no fold" departs from lightningcss at 13 sites. REVIEW.md:36: for ported code the reference is the spec. The same keep-or-replace question is at the top of #45814 with no human answer.
- Private machinery (`written`/`elsewhere` ledger, `other` parameter, `mark` scan) overlaps #45814, #42042, #45747. REVIEW.md:66.

## Sequenced set the review recommends

1. Riders out. #33684 and #38589 land first (or the one supports.rs line alone).
2. Rows PR (about +380): text-decoration, -line, -style, -thickness rows, value types, no-target parse/print tests. No `prefix_feature` arms until #38692 lands (see defect 3).
3. Maintainer ruling (asked on #45814): keep author prefixes in place, or buffer and replace as lightningcss. Also: no fold, and whether a line-only `text-decoration` always gets the `-webkit-` copy.
4. Handler PR for text-decoration only, built to the ruling, on shared chain machinery.
5. Follow-ups: text-emphasis, list-style-image, docs example.

## Defects the review found in the branch (fix them in whichever PR takes the code)

1. `-webkit-text-decoration: var(--x)` copy is written before the unprefixed line. In WebKit the unprefixed `var()` declaration then becomes `unset` at computed-value time and wins. Write the copy after it. (WebKit source trace, not a Safari run. lightningcss has the same order.)
2. `text-emphasis-position: under right` prints `under`. Firefox before 108 needs both keywords. Print both on the unprefixed name.
3. The new `prefix_feature` rows expand names in `transition` lists. After a rule merge `transition: text-decoration 1s` has the prefixed name twice (TransitionHandler, #38692).
4. The oracle tests withhold a copy on the same `written` condition as the handler, so they cannot catch a wrong withhold. Compute the expectation from the input alone. Add thickness, prefixed longhand, `inherit`, `!important` atoms.
5. 76 of the 195 pinned outputs differ from lightningcss 1.32.0 (the body said 8 of 77 upstream assertions). Two gradient pins (`-webkit-linear-gradient(#ff0f0e, #7773ff)`, upstream has `top,`) have no note.
6. An earlier shorthand that names no color counts as the author's color fallback: `text-decoration: underline; text-decoration-color: lab(...)` gets no fallback.
7. The `-webkit-` copy is gated on "value differs from the default", not on "the author wrote a style or color": `text-decoration: underline solid currentcolor` stays bare.
8. Any unknown name clears the list-style-image ledger. Make unknown names transparent, find `list-style` and `all` by name.
9. list-style-image: after `url(a.png)`, a later gradient with lab() gets generated RGB and P3 lines that override the author's fallback.
10. One author-written prefixed longhand switches off the shorthand's copy (`-webkit-text-decoration-color: red; text-decoration: underline wavy blue` gets no `-webkit-text-decoration`). Key the ledger on the declaration's own name.
11. The split-off thickness is never reset: `text-decoration: underline 2px; text-decoration: overline` leaves 2px in Safari. Push `text-decoration-thickness: auto`.
12. `text-decoration-thickness: 0%` prints `calc(1em / 3.40282e38)`. Build an `em` dimension.
13. `composes` diagnostics change (prefixed and unprefixed name are one property). Disclose and test.
14. `Property::All` and `Unparsed(All)` arms cannot match (`all` has no row). Delete them.

## Facts worth keeping

- The lightningcss fold fires 0 times on the 15 fixture sheets. A buffered port moves 31 of 128 blocks on every target and is not byte-stable in a second pass.
- In Bun, `all`, `cursor`, `vertical-align` and many more are unknown names (`Property::Custom` with an `Unknown` name).
- 254 + any 3 new rows crosses 256 `Property` variants: the tag becomes 16 bits, `PropertyBitset` 32 to 64 bytes, about +11 instructions per declaration in other handlers.
- Debug binaries are not self-contained (they load JS from build/debug). Use release binaries for A/B probes after a rebuild.
