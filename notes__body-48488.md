### Problem

- `bun build --dts` writes a class member with no annotation and no value as bare `level;` into `index.aot.ts`. Once the build removes its stores (`--define`), it is `any`, not `string | undefined`.
- `bun compile` then accepts `const wrong: number = new Logger().level`. `bun check` prints `TS7008: Member 'level' implicitly has an 'any' type.`
- Cause: `copy_slots` (`src/sema/driver/typed_files.rs:3078`) writes nothing where the sources have no annotation.

### Fix

- `module_types` notes the sources' type of such a member, if it names nothing. `copy_slots` writes it: `level: string | undefined;`.
- `text_that_names_nothing` gives the text, as in #48267. A constant `Infinity` (TS2749) is `number`.
- Also fixed in added lines: order at a minified class end (TS1068), repeated decorators (`declare @dec x: T;` is TS1068, `@dec declare x: T;` ran `dec` twice), and `declare override` (TS1243).
- Verified: 16 new tests fail on main. Self-reviewed: 18 concerns, 12 addressed, 4 held (`accessor`), 2 main's limits (Notes).

### Background

- `index.aot.ts` is `index.js` with the source types put back, for `bun compile`.
- TypeScript types such a member from constructor stores.
- Names nothing: a keyword, a literal, or a union of those. A bundle can reuse a name.
- Considered `: any` at each TS7008: a program still gets `any`.

### Downsides

- A typed file that types a store differently from the sources is left out with a warning.
- Per such member: 1 checker query, 2.4 to 5.4 allocator calls, 8 bytes (`: number`). Binary: +2,304 text bytes.
- Unchanged: a type that names a declaration, `accessor` fields, a valued field under `useDefineForClassFields: false`.

<details><summary>Notes</summary>

**Where this comes from**

No issue reports this. A review of #42643 found it in `typed_files.rs` of main. That file landed in #45631 and is in no release. A member that has an annotation in the source (`level: string | undefined;`) is written with it on main, so the author of a package can avoid the fault today.

**Repro**

Each project has `tsconfig.json` `{"compilerOptions":{"strict":true,"module":"esnext","moduleResolution":"bundler","target":"esnext","types":[]}}` and `package.json` `{"name":"shapes","version":"1.0.0"}`.

```ts
// src/index.ts, built with: bun build ./src/index.ts --outdir out --dts
declare const process: { env: Record<string, string | undefined> };
export class Logger {
  level;
  constructor() {
    if (process.env.NODE_ENV === "production") this.level = "warn";
  }
}
```

On main the build exits 0 and prints no warning. `out/index.aot.ts` has `level;`, and `out/index.d.ts` has `level: string | undefined;`. `bun check` in the project prints `out/index.aot.ts(3,3): error TS7008: Member 'level' implicitly has an 'any' type.` The typed file now has the line of `index.d.ts`, and `bun check` prints nothing.

- `--define __DEV__=false` with `if (__DEV__) this.level = "warn";` gives the same result. So does a `static` member that a `static {}` block stores.
- `bun compile --library` does not replace `process.env.NODE_ENV`, so there it needs `--define`.
- With `if (__DEV__) this.level = "debug"; else this.level = level;` the bundle keeps the store of a number. On main the typed file then types `level` as `number`, and `index.d.ts` says `string | number`. Now the typed file says `level: string | number;`.

The program is in `test/aot/library-typed-file.test.ts`. The package has `unit; constructor() { if (__DEV__) this.unit = "cm" as Unit; }` and is built with `bun compile --library src/index.ts --define __DEV__=false`. The program is `const wrong: number = new Ruler().unit;`. `bun check app.ts` refuses it: `TS2322: Type 'string | undefined' is not assignable to type 'number'.` On main `bun compile ./app.ts` builds it, and the executable prints `undefined`. Now `bun compile` prints the same TS2322.

**What the typed file has now**

| source | main | now |
| --- | --- | --- |
| `x;` whose only store is dead code | `x;`, which is `any` | `x: string \| undefined;` |
| `static n;` with a dead store in a `static {}` block | `static n;` | `static n: number \| undefined;` |
| `x;` with a dead `string` store and a kept `number` store | `x;`, which is `number` | `x: string \| number;` |
| `x?;` | `x?;` | `x?: string \| undefined;` |
| `#x;` | `#x;` | `#x: bigint \| undefined;` |
| `x;` with a dead store of `Mode`, which is `"fast" \| "slow"` | `x;` | `x: "fast" \| "slow" \| undefined;` |
| `x;` with a dead store of `1e999 as const` | `x;` | `x: number \| undefined;` |
| `x;` with its stores kept | `x;` | `x: string;` |
| `x;` with a dead store, after an `accessor` field | `x = (..., undefined);` | `x: number \| undefined = (..., undefined);` |
| `x;` with a dead store of a `Map` or of a member of an enum | `x;` | the same |
| `x;` under `useDefineForClassFields: false` | no member, and TS2339 for each use | `declare x: number;` |
| a field with a value, `valued = 1` | as written | the same |
| a member of a module under `// @ts-nocheck` | as written | the same |

The build runs what an `accessor` field starts with in the field after it, so a field with no value gets `(..., undefined)` there. On main the check of the typed file reads `undefined` as the type of that field.

**How it decides**

- A member is noted if it is a class property with no annotation and no value, and is not `declare` or `abstract`. Members are noted only under `noImplicitAny`. Without that option TypeScript does not type a member by its stores, so the member is `any` in the sources and in the typed file.
- `text_that_names_nothing` says what a type is written as: its keyword, or the text of a string, number or bigint literal. It has no text for a member of an enum, for a type that did not resolve, and for every other type. A number literal that is not finite is `number`, because `Infinity` is the name of a value.
- A union is written type by type, with `boolean` for `false | true`, and `null` and `undefined` last. The printer of the checker writes the name of an alias for such a union (`Mode | undefined`), and that name can belong to another declaration in the bundle.
- The checker has a type for a value that is absent. The note leaves it out only for an optional member under `exactOptionalPropertyTypes`, where `?` says it: `x?: string;`. Everywhere else it is `undefined`, for example for a read of an index under `noUncheckedIndexedAccess`.
- `copy_slots` writes the note at the slot of the member, where the sources have no annotation. `x?;` gets `?: T`. A module under `// @ts-nocheck` gets nothing, as before.
- With `useDefineForClassFields: false` the bundle has no field for such a member. There `copy_members` writes the note as `declare x: T;`, as it does for a member with an annotation.
- `module_types` runs on the sources and does not know which stores the build removes, so every such member is noted. Where the bundle keeps the stores, the note is the type that TypeScript infers from them. The sources already refuse what an annotation refuses: a store of another type in the constructor (TS2322), and a read before the store (TS2565).
- No `!` is written with a note. On a member that a base class declares too, `!` is TS2612.

**Also fixed: the end of a minified class**

With `--minify-whitespace` the last member of a class has no `;`. Its type, a cast of its value and a member that has no JavaScript (an `abstract` method, an index signature, a `declare` field) are then written at the same offset, and the member came first: `kind;abstract area(): number;` and then `: string}`, which is TS1068. Main has this fault for a member with an annotation or with a cast (`name = "n" as const`). The notes would have brought it to a member without an annotation. A line for the end of a class now has an order of its own (`Order::ClassEnd`) that sorts behind everything else at that offset.

**Also fixed: the decorators of a member that has no JavaScript**

With `"experimentalDecorators": true` the bundle calls the decorators of a member behind the class (`__legacyDecorateClassTS([column], Row.prototype, "id", undefined)`). It has no field for the member, because it stores in the constructor. `copy_members` adds a line to the typed file for such a member, and for a `declare` or `abstract` member. On main that line starts at the first decorator.

| source | main | now |
| --- | --- | --- |
| `@column id: number;` | `declare @column id: number;`, which is TS1068, so no typed file | `declare id: number;` |
| `@column name;` with a dead store | no line | `declare name: string \| undefined;` |
| `@column declare owner: string;` or `@column abstract kind: string;` | the same text, and a program runs `column` twice | `declare owner: string;`, `abstract kind: string;` |
| `constructor(@inject private readonly name: string)` under `useDefineForClassFields: false`, in a module that `import()` loads | `declare @inject private readonly name: string;`, which is TS1068 | `declare private readonly name: string;` |

- The review on this PR found the second row in the form that the note had given it: `declare @column name: string | undefined;`. The other three rows are faults of main.
- `decorators_end` says where the decorators in front of a member or a parameter end. `member_slots` had the same lines for a member that has JavaScript, and now calls it.
- A comment between the decorators and a `declare` or `abstract` member stays in the text of the member, as on main. It can be a directive: `@column`, then `// @ts-expect-error`, then `declare id: number;`.
- `test/aot/library-typed-file.test.ts` has the program for the third row. It prints what the decorators saw: `id,name,id,name` on main, and `id,name` now, which is what `index.js` prints.
- A build with these decorators gets a typed file only if `Reflect.decorate` is declared, as `reflect-metadata` declares it. The helper of the bundle reads it (TS2339 without, on main too). A decorator of a class or of a parameter assigns to the class. For a class statement that is TS2629, on main too.

**Also fixed: `override` behind `declare`**

A line that `copy_members` adds with `declare` kept the `override` of the member: `declare override label: string;`. That is TS1243. The check of a typed file drops it, because it is a grammar diagnostic of a dependency, so the typed file is written and a program compiles. But `bun check` and `tsc` print it where the file is a source of a project. Main has this for a member with an annotation and for a parameter property, and the note brought it to a member without an annotation. `Written::declared` now writes the text behind `declare` for all three lines, without decorators and without `override`. A member with `declare` needs no `override` under `noImplicitOverride`. The test for `useDefineForClassFields: false` has the three lines and runs `bun check` on the project.

**Designs that were weighed**

- `: any` at each TS7008, in the loop that checks the typed files. It needs one more check round, and the member is `any` where `index.d.ts` says `string | undefined`. The program above still compiles.
- To note only a member that a path of the constructor leaves without a store (its type has `undefined`). That leaves `level` above with the type of the one store that the bundle keeps. It also keeps a typed file whose member has another type than the sources (the first Downside), without a warning.
- To keep the stores: no dead code removal in a `--dts` build. That changes `index.js` for every consumer of the package.
- To read the member types from the emitted `index.d.ts`. The declarations are printed for another file layout (one file for each source), with names that the bundle renames.

**Measurements**

Debug builds of main 98cda0d8b1 and of this branch on it, before the last five commits, under `gdb` with breakpoint counts. Those commits add no allocation for a member that the bundle has a field for.

| | main | this branch |
| --- | --- | --- |
| `sources` of `compile-library.test.ts`: allocator calls in `module_types` / `add_types` | 68 / 670 | 68 / 670 |
| `rewritten` of that file: the same | 97 / 852 | 97 / 852 |
| 200 modules with 4,000 members that every path of the constructor stores: the same | 45,428 / 35,697 | 51,028 / 39,702 |
| the same: calls of `type_at_location` in `module_types` | 0 | 4,000 |
| the same: `index.aot.ts`, bytes | 193,081 | 225,081 |
| 200 modules with 4,000 members that a path leaves without a store: allocator calls | 45,428 / 43,711 | 63,028 / 47,716 |
| the same: `index.aot.ts`, bytes | 289,081 | 369,081 |
| type-check passes, sources + typed files: the `--define` repro | 1 + 1 | 1 + 1 |
| `sources` | 1 + 1 | 1 + 1 |
| the `--splitting` project of `compile-library.test.ts` that is refused (TS2345) | 1 + 2, and 1 of the emitted declarations | the same |
| `sources` without `--dts`: calls of `module_types` / `add_types` / `copy_slots` | 0 / 0 / 0 | 0 / 0 / 0 |
| release binary, `size`: text bytes (main 89452d2ac1 and the final branch, in one build directory) | 143,094,946 | 143,097,250 (+2,304) |
| the same: file bytes | 143,284,496 | 143,288,592 (+4,096) |

- Neither fixture of the test file has a member with no annotation and no value. One of four runs of `sources` counted 69 in `module_types`, with the binary of main.
- A member with no annotation and no value costs 1 `type_at_location`. A noted one costs 1.4 (`number`) to 4.4 (`number | undefined`) allocator calls in `module_types` and 1.0 in `add_types`, and the bytes of its type in `index.aot.ts` (`: number` is 8).
- The `index.js` of each of the two libraries has the same size with both binaries (189,881 and 285,881 bytes).
- The commit for decorators adds no allocation and no pass for a member without a decorator. `member_slots` runs the same steps as before. A line that `copy_members` adds looks at the first modifier of its member once.
- Instruction counts were not measured: `perf` and `valgrind` are not in my container.

**Outputs against main**

A set of 104 small libraries, each with one rewrite of the bundle (dead stores, `accessor`, folded values, namespaces, `using`, enums, casts), built with both binaries (main 98cda0d8b1, and an earlier head of this branch). For each typed file that was written I emitted declarations from it again and compared them with the `index.d.ts` of the sources. The set and its script are not in the tree, so these counts are a record of what I ran and no test.

| | main | this branch |
| --- | --- | --- |
| the sources do not build | 6 | 6 |
| typed file left out | 33 | 34 |
| written, declarations equal `index.d.ts` | 22 | 35 |
| written, declarations differ | 43 | 29 |
| written, with TS7008 as a source of its own project | 19 | 4 |

- 13 inputs move to "equal" (11 from "differ", 2 from "left out"). 1 moves from "left out" to "differ": the constant that was `Infinity`.
- 4 move from written to left out. Each stores the result of an overloaded function that gets a member of a namespace: `this.size = pick(Defaults.size)`. The typed file has `any` for the namespace object, so `pick` answers with its first signature. On main the member takes the type of that store (`string`, where `index.d.ts` says `number`). Now the noted type refuses the store: `TS2322: Type 'string' is not assignable to type 'number'.` The test "a store that the .aot.ts file types in another way than the sources is a warning" pins this.
- The 4 files that still have TS7008 have a member whose type names a declaration, or a property on a function.

**Not fixed**

- A member whose type names a declaration (`Map<string, number>`, `string[]`, `Date`, a member of an enum, a type parameter) is written as on main. With a dead store it is `any` for a program that installs the package. A note is text that `link` does not see, so a name in it can bind to another declaration of the bundle.
- `useDefineForClassFields: false`: a field with a value and no annotation (`count = 0`) has no field in the bundle and no declaration in the typed file. The typed file is left out, as on main: `TS2339: Property 'count' does not exist on type 'Counter'.` Only a member with no value gets a declaration, from its note.
- A `declare` or `abstract` member with no annotation is copied as the source has it.
- `declare x!: T;` for a member with `!` and an annotation that the bundle has no field for. It is TS1255 where the file is checked as a source, as on main.
- A type inside the decorator of a `declare` or `abstract` member (`@column(loose as Options) declare id: number;`) is not put back at the call in the bundle. If the call needs it, the typed file is left out (TS2345), as on main. For every other member it is put back.
- A `// @ts-expect-error` or `// @ts-ignore` in front of a member that the typed file adds a line for does not reach the typed file, as on main. That is a `declare` or `abstract` member, and a member or a parameter property that the bundle has no field for. Only a comment between a decorator and a `declare` or `abstract` member stays.
- A class with a decorator inside `declare module "./other" { }` leaves the typed file out (TS1005), as on main.
- Decorators without `experimentalDecorators`: the helpers of the bundle do not pass the check of the typed file (TS18048), as on main.
- A field with a value that `--define` narrows (`x = __DEV__ ? "dev" : 1`), and a variable, a return type or a parameter default that the build narrows.
- An `accessor` field. Bun writes a public `accessor x` as a `WeakMap`, a getter and a setter, and the getter is `any` in the typed file. A field with no value after it gets the value `(..., undefined)`, which refuses an annotation that has no `undefined`. The typed-file changes for both are held until #42643 has an answer on how `accessor` is written. An earlier form is on the branch `robobun/322b70cd/dts-accessor-getter-types`.

**Other open PRs**

- #48267 has `text_that_names_nothing` too, for a constant and for a parameter. The first commit here has the function, the change to the `constants` loop and the test for it with the same text. A trial merge of the two heads keeps one copy of the function.
- #42643 writes `: any` on the field that it makes for an untyped `accessor #x`, in the same branch of `copy_slots`. The rule for the two together: the note first, `: any` only where no note exists. Its test then expects other lines for five members.
- #48466 changes `typed_files.rs` near these lines, and #48392 adds tests at the same places. A trial merge with each has textual conflicts only.

**Reviews**

The first review of this work said to split it from the typed-file changes for `accessor` fields and to use the rule of #48267. It raised 7 concerns: 3 for this half (a test that fails for each clause, another printer mode, a test at the layer of `module_types`), which are addressed, and 4 for the `accessor` half. A second review of this diff found two faults: an optional member under `exactOptionalPropertyTypes`, and the end of a minified class. It also said that an annotation refuses a second store of another type and a read before the store where the sources accept them. I ran both: the sources refuse them too (TS2322, TS2565).

The review on this PR found three more things, which d6905d39c1 repairs. The note left `undefined` out for a read of an index under `noUncheckedIndexedAccess`. A cast at the end of a minified class had the same order fault as a type. And `sort_by_key` in the union text cost 9,984 bytes of text, so the order is now made without a sort.

A later round found that a noted member had no declaration under `useDefineForClassFields: false`. 4ea1e33369 adds it. That round also said that the note of `second?` loses a package under `exactOptionalPropertyTypes` with `noUncheckedIndexedAccess`, where the member is stored from a read of an index. That source does not build, on main too: the check of the sources refuses the store (TS2412).

The next round found that the `declare` line of a noted member repeated its decorators. Main has the same fault in the three other lines that `copy_members` adds, so 4016e9dc2a repairs all four. A self-review of that commit raised 9 concerns. 7 are addressed: a comment between a decorator and a `declare` member went away with the decorators, the line for a parameter property was left as it was, the program test did not pin that `index.aot.ts` was compiled, two more points on the tests, the name of the helper, and the commit message. 2 are limits of main and are under "Not fixed": a type inside the decorator of a `declare` member, and a decorated class in `declare module`.

The round after that said that `declare override x: T;` fails the check of the typed file. It does not: the file is written, and a program compiles against the package. The text is TS1243 for `tsc` and for `bun check` of a project that has the file as a source, so the last commit leaves `override` out of the three lines with `declare`. A review also proposed to keep a comment between a decorator and a member with no field, for a directive. That is not done. The comment would stand between `declare` and the name, where a line comment ends the line and `declare` becomes the name of a property. In front of the line, an `@ts-expect-error` can have no error left to expect (TS2578). Without a decorator the same directive is lost on main too.

**Suites run**

Release builds of this branch and of main 89452d2ac1 (the base), with the tests of this branch:

| | main | this branch |
| --- | --- | --- |
| `test/bundler/bun-build-dts.test.ts` | 11 pass, 8 fail | 19 pass |
| `test/bundler/bun-build-api-dts.test.ts` | 8 pass, 3 fail | 11 pass |
| `test/cli/compile/compile-library.test.ts` | 58 pass, 3 fail | 61 pass |
| `test/aot/library-typed-file.test.ts` | 6 pass, 2 fail | 8 pass |

- The 16 tests that fail on main are the 16 new ones.
- `cargo test -p bun_sema_driver`: 282 pass. 4 are new, in `compile/tests/noted_members.rs`. They do not compile on main.
- `test/internal/source-lints/`: 200 pass. `cargo clippy -p bun_sema_driver` has no warning.
- Each of these 12 clauses, taken out one at a time, fails a Rust test: the `noImplicitAny` test, the four tests of what a member is (a property, no annotation, no value, not `declare`), the enum test and the `number` for a literal that is not finite in `text_that_names_nothing`, and in the union text the `boolean`, the order, the one copy of a text that two types share, the part for an absent value that an optional member leaves out, and the same part that every other member keeps.
- Before the rebase and the last five commits, a debug build with ASAN on main 98cda0d8b1 passed the same four files (14, 11, 59 and 7 tests). The ASAN lane of CI passed the four files on 4ea1e33369, the head before the commit for decorators. One old test of `compile-library.test.ts` has a limit of 60 s and needs more in a debug build, with main too.

</details>

<!-- robobun:evidence:begin -->

---

**no test proof** · iteration 1 · platform-specific test(s) that do not run on this machine, deferring to CI, which covers all platforms: test/cli/compile/compile-library.test.ts, test/aot/library-typed-file.test.ts

<!-- robobun:evidence:end -->





