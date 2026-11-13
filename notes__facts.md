# Facts measured before the container reset (Nov 12, 2026), for the PR notes

Base = head of PR 48488 (17ebf4239a). Branch = stacked delta.

Release size, linux-x64, `size`:
- base: text 143,097,250, data 124,448, bss 1,862,184, file 143,288,592
- branch (0c9f6e69bb4 code, after the review fixes): text 143,122,082 (+24,832), data +0, bss +0, file 143,313,168 (+24,576)

gdb breakpoint counts, debug builds: allocator calls in module_types / in add_types, stated_type calls, check_request calls
- sources of compile-library.test.ts (2 entries): base 91 / 1341 / - / 2 ; branch 91 / 1341 / 0 / 2
- define200 (200 valued fields, define mode): base 24 / 667 / - / 2 ; branch 24 / 667 / 0 / 2
- definebare200 (200 bare members, number): base 238 / 1311 / - / 2 ; branch 434 / 1525 / 200 / 2
- definenamed200 (200 bare members, class Item): base 36 / 1524 / - / 2 ; branch 2615 / 2545 / 200 / 2
- assign1: base 18 / 490 / - / 3 (left out) ; branch 25 / 497 / 1 / 2
- assign20: base 21 / 544 / - / 3 (left out) ; branch 88 / 652 / 20 / 2
- assign200: base 24 / 676 / - / 3 (left out) ; branch 634 / 1691 / 200 / 2

Fail-before on base (debug, tests of the branch):
- test/aot/typed-file-unannotated-members.test.ts: 3 pass, 9 fail, 1 todo (branch: 12 pass, 1 todo)
- test/aot/library-typed-file.test.ts: 7 pass, 3 fail (branch: 10 pass)
- test/bundler/bun-build-dts.test.ts: 18 pass, 2 fail (branch: 20 pass, with --timeout=120000)
- test/bundler/bun-build-api-dts.test.ts: 11 pass, 2 fail (branch: 13 pass)

Other suites on the branch (debug): compile-library 60/61 (old test hits its own 60 s limit), compile-library-ecosystem 51 pass 1 todo 1 fail (the same test fails on base), compile-library-aot-condition 13, typed-packages 5, library-from-npm 40, specifiers-in-declarations 3, check-lists-dependency-type-errors 4, type-errors-of-untyped-imports 10, source-lints 200, bun_sema_driver 286, clippy clean for bun_sema and bun_sema_driver.

Differential matrix, 17 projects with bare members and dead stores (base vs branch):
- define mode: both write all 17 typed files; .js and .d.ts identical; no new error in the typed file as a source; TS7008 gone for typed members
- assign mode: base leaves 8 of 17 without typed files; branch writes 17

# After the container reset (rebuilt from refs/wip/a8fe191a/dts-stated-types) and the fixes from the second self-review
- Fixes: (A) link refuses a class whose only declaration in the typed file is a twin from the emitted declarations (--splitting --define, with an annotation that hoists the twin); (B) no copy of the parser's move rule: every unannotated property of an assign-mode module gets a row (static, accessor, computed too), Syntax::is_assigned_in_constructor removed; (C) names_nothing renamed has_only_keywords; bun check removed from the names test in bun-build-dts.test.ts (kept light).
- Counts on the fixed debug binary: identical to the table above for all 7 fixtures.
- Release size on the fixed code (0c9f6e69bb4): text 143,122,082 (+24,832 over base 143,097,250).
- Tests on the fixed debug build: aot unannotated-members 13 pass 1 todo (the twin test fails on the pre-fix binary); library-typed-file 10; bun-build-dts 20 (--timeout=120000); api-dts 13; sema_driver stated_members 8 (286 total before the fixes); compile-library 60/61 (old 60 s limit); ecosystem 50-51 pass (1 fails on base too, 1 load flake that passes alone); aot-condition 13; typed-packages 5; library-from-npm 40; specifiers-in-declarations 3.
- Review points known from the truncated result: fold or stack (kept: stacked, first line of the body says merge into the branch of 48488 or after it); order vs 48466, 48392, 46553 (in Notes); `declare x!: T` TS1255 reaches more builds (documented, belongs to 48392); seven other shapes still drop typed files (Limits).
- Differential matrix rerun after the fixes (18 projects, incl. valued statics and a computed name): define mode: both write 18, no regression, no new error, .js/.d.ts identical; assign mode: base leaves 9 of 18 out, branch writes 18.
- Fix D (found in the reviewers' probes): Services::stated_type refuses a text in which the printer left a part out (new printer flag MARK_ELISIONS, marker `/*elided*/ any`): nesting below ten levels and a type inside itself. New shape in the aot test fails on the binary before this fix. aot file: 13 pass 1 todo.
