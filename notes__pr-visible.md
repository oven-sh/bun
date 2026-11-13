Contains #48488: its commits are in this branch, and this PR replaces its member path. #48488 is obsolete when this merges.

### Problem
- `bun build --dts` with `"useDefineForClassFields": false` writes no `.aot.ts` file for `class Box { n = 1 }`: `warn: the .aot.ts files that --aot compiles a package from are left out: they have type errors, the first at index.aot.ts:4:10: TS2339: Property 'n' does not exist on type 'Box'.`
- A member with no value (`level;`) whose stores `--define` removes is `any` (TS7008).
- Cause: `copy_slots` and `copy_members` (`src/sema/driver/typed_files.rs`) write a type only for an annotation.

### Fix
- `module_types` states each unannotated member with the declaration printer's text (`Services::stated_type`): `declare n: number;`.
- `link` gives each name the typed file's name (`Item2`), or drops the text. A member with no text gets no line, as on main.
- Verified: 43 tests in five files fail on main (`test/aot/typed-file-unannotated-members.test.ts` first). Self-reviewed: 38 concerns raised, 22 addressed, 16 kept (Notes).

### Background
- `index.aot.ts` is `index.js` plus the source types. `--aot` compiles a package from it.
- TypeScript types such a member from its value or its constructor stores. The option moves the value. `--define` can remove a store.
- Considered a bare `declare n;`: `readonly kind = "circle"` becomes `string`. Considered a bundler flag for files that move fields: the writer sees that in the bundle.

### Downsides
- Per unannotated member: 2 to 15 allocator calls in `module_types`, 1 to 11 in `add_types`, also where the field keeps its value. Binary: +48,640 text bytes.
- A derived class with no constructor whose base takes arguments gets no typed file (new warning). Main wrote `class E extends Error { status: number = 500 }` with a zero-parameter constructor.
- Still left out, as on main: a field whose type the typed file cannot name (a class of another output, a type inside itself).
