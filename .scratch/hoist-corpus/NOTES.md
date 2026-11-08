Scratch files. Not for review. Delete with the branch.

This branch = PR oven-sh/bun#43603 at 4872749bad + one hunk in src/react_compiler/lowering/build_hir/stmt.rs:
the function declarations that a function hoisted at statement i names, declared at or below i, are hoisted at i too
(the idea of facebook/react#36541, for Bun's index-based scan). It is the follow-up that the notes of #43603 name
("A function that a later function reads above its declaration", facebook/react#33689).

Corpus 1: gen1.mjs (2,160 shapes: 15 early references x 2 helper bodies x 3 sibling bodies x 4 orders x 6 uses).
Corpus 2: gen2.mjs (2,640 shapes: three declarations in chains or mutual recursion, 6 orders, 5 uses, flat or in an `if`).
entry.js renders each function 5 times through one memo cache; run.mjs compares with the bundle without the compiler.
Fake react (node_modules/react): index.js exports useState (calls an initializer function), useEffect (pushes to
globalThis.__effects), useCallback, useMemo; jsx runtimes return { type, props }; compiler-runtime.js keeps one cache
per globalThis.__key and sets globalThis.__compiled.
Run: node gen.mjs && node run.mjs main=<bin> pr=<bin> follow=<bin>

Measured on 8 Nov 2026, debug builds, main 2596ac5d39 -> #43603 at 4872749bad -> this branch:
  corpus 1: 920 ok, 736 as written, 268 WRONG->ok->ok, 132 WRONG->asis->asis, 64 THROWS->THROWS->ok,
            16 THROWS->THROWS->asis, 16 ok->ok->asis, 8 WRONG->ok->asis
  corpus 2: 1451 ok, 832 as written, 160 THROWS->THROWS->ok, 92 THROWS->THROWS->asis, 47 WRONG->ok->ok,
            31 WRONG->asis->asis, 11 asis->asis->ok, 8 ok->ok->asis, 8 THROWS->asis->asis
  So: 332 shapes throw on main and with #43603 (ReferenceError or TypeError). None throws or is wrong on this branch.
  24 shapes go from compiled to as written.
Suites on this branch (debug): react-compiler.test.ts 148 pass, react-compiler-fixtures-run 849 pass, lint conformance 3 pass.
react-compiler-fixtures.test.ts: 3293 pass with the same hunk on the older base (86036c0764); on this base the setup of
the suite timed out at 120 s three times on a slow machine, and it did the same with a build of main at that time.
