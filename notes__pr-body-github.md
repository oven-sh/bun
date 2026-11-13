Contains #48488, which is obsolete when this merges.

### Problem
- Under `"useDefineForClassFields": false`, `bun build --dts` writes no `.aot.ts` file for `class Box { n = 1 }`: `warn: the .aot.ts files that --aot compiles a package from are left out: they have type errors, the first at index.aot.ts:4:10: TS2339: Property 'n' does not exist on type 'Box'.`
- Cause: `copy_slots` and `copy_members` (`src/sema/driver/typed_files.rs`) write a type only for an annotation. The option moves the value that types `n` into the constructor.

### Fix
- `module_types` states each unannotated member with the declaration printer's text (`Services::stated_type`): `declare n: number;`.
- `link` writes each name as the typed file has it (`Item2`), or drops the text.
- Verified: 44 tests in five files fail on main (`test/aot/typed-file-unannotated-members.test.ts` first). Self-reviewed: 65 concerns raised, 48 addressed, 17 kept (Notes).

### Background
- `index.aot.ts` is `index.js` plus the source types. `--aot` compiles a package from it.
- Considered a bare `declare n;`: `readonly kind = "circle"` becomes `string`. Considered a bundler flag: the writer sees the moved fields in the bundle.

### Downsides
- Up to 15 allocator calls per unannotated member in `module_types` and 11 in `add_types`, in every build. Binary: +48,640 text bytes.
- A member with no value (`level;`) now has the type of the sources. A store of another type in the bundle leaves the typed files out (TS2322). Main wrote them for a value from a bundled dependency's JavaScript.
- A derived class with no constructor whose base takes arguments gets no typed file. Main wrote one with a zero-parameter constructor.

<details><summary>Notes</summary>

**Where this comes from**

No issue reports this. `typed_files.rs` landed in #45631 and is in no release. #48488 found the member with no value, and its body lists "a valued field under `useDefineForClassFields: false`" as unchanged. A review of the two asked for one mechanism. So this PR removes the member path that #48488 adds: `ModuleTypes::members`, `member_type`, `Written::noted_member` and `text_of_types_that_name_nothing`. What #48488 has beside that path stays: `text_that_names_nothing` for constants, the order at the end of a minified class (`Order::ClassEnd`), one copy of a decorator, and no `override` behind `declare`.

**Repro**

```sh
mkdir -p r/src && cd r
echo '{"compilerOptions":{"strict":true,"lib":["es2015"],"useDefineForClassFields":false,"module":"preserve","moduleResolution":"bundler","noEmit":true,"types":[]}}' > tsconfig.json
echo '{"name":"f","version":"1.0.0","compilerOptions":{"strict":true,"lib":["es2015"],"useDefineForClassFields":false}}' > package.json
cat > src/index.ts <<'TS'
export class Box {
  n = 1;
  label(): string {
    return String(this.n);
  }
}
TS
bun build ./src/index.ts --dts --outdir out
```

On main (89452d2ac1) the build exits 0, prints the warning above and writes `index.js` and `index.d.ts` only. Now it also writes `out/index.aot.ts`:

```ts
// src/index.ts
class Box {
  constructor() {
    this.n = 1;
  }
  declare n: number;
  label(): string {
    return String(this.n);
  }
}
export {
  Box
};
```

The member with no value: `export class Logger { level; constructor() { if (process.env.NODE_ENV === "production") this.level = "warn"; } }`, built with `--dts`. Main writes `level;` (TS7008 for `bun check`, `any` for a program). Now: `level: string | undefined;`.

**What the typed file has now**

With `useDefineForClassFields: false` (the bundle has no field):

| source | main | now |
| --- | --- | --- |
| `n = 1;` | no member, TS2339, no typed file | `declare n: number;` |
| `readonly kind = "circle";` | the same | `declare readonly kind = "circle";` |
| `unit = Unit.Px;`, `readonly fixed = Unit.Em;` | the same | `declare unit: Unit2;`, `declare readonly fixed = Unit2.Em;` |
| `mode = Mode.Fast;` with an enum of another module | the same | `declare mode: Mode;` and the store `"fast" as Mode.Fast` |
| `others = new Map<string, Other>();` where the bundle names the class `Item2` | the same | `declare others: Map<string, Item2>;` |
| `private count = 1;` | the same | `declare private count: number;` |
| `level;` (no value) | the same | `declare level: string;` |
| `pick = <U>(value: U): U => value;` | the same | `declare pick: <U>(value: U) => U;` |
| `hidden = hide();` where the module does not import `Hidden` | the same | `declare hidden: Hidden;` |
| `circle = shapes.makeCircle();` behind `import * as shapes` | the same | `declare circle: Circle;` |
| `held = new Other();` where a binding of a function has the bundle's name `Item2` | the same | `declare held: outer.Item2;` |
| `emitter = new Emitter();` of a package that is not bundled | the same | `declare emitter: Emitter2;` and `import type { Emitter as Emitter2 } from "ext";` |
| `items = null as Map<string, number> \| null;` where the bundle has a class `Map` | the same | `declare items: globalThis.Map<string, number> \| null;` |
| `options = {} as Shapes.Options;`, an interface of a namespace | the same | `declare options: Shapes.Options;` |
| `items = [] as T[];` in `class Stack<T>`, `next = null as Link \| null;` in `class Link` of a class expression | the same | `declare items: T[];`, `declare next: Link \| null;` |
| `"quoted name" = 1;`, `0 = "zero";`, `maybe? = 2;` | the same | `declare "quoted name": number;`, `declare 0: string;`, `declare maybe?: number \| undefined;` |
| `#held = null as string \| null;` | `#held;`, typed by its stores | `#held: string \| null;` |
| `#mode = Mode.Fast;` with an enum of another module | `#mode;`, typed `string` | `#mode: Mode;` and the store `"fast" as Mode.Fast` |
| `readonly #kind = "box";` | `readonly #kind;`, typed by its store | the same |
| `constructor(public held = null as string \| null)` | `declare public held;` | `declare public held: string \| null;` |
| `constructor(public first = 1, readonly name: string)` | `declare public first;` | `declare public first: number;` |
| `constructor(public given = Mode.Fast)` with an enum of another module | `declare public given;`, typed `string` | `declare public given: Mode;` and `given: Mode = "fast" as Mode.Fast` |
| `class Derived extends Base { m = 2; }` where `Base` takes no argument | TS2556, no typed file | `declare m: number;` and `super(...arguments as any as [])` |
| `class HttpError extends Error { status = 500; }` | no member, TS2339, no typed file | no typed file, with a warning of its own |
| `kind = Shapes.Kind.Circle;`: an enum of a namespace, or of a function | no member | the same |
| `api = { count: 0, add() { return this; } };`: a type inside itself | no member | the same |
| `item = new Item();` where only another output has `Item`, or a bundled package | no member | the same |
| any of these under `// @ts-nocheck` | no member | `declare n;` |

Where the build defines the fields (the default):

| source | main | now |
| --- | --- | --- |
| `level;`, and `--define` removes its store of a `string` | `level;`, which is `any` | `level: string \| undefined;` |
| the same with `Mode`, a class, an enum, `Map<string, Other>` or `T` | `mode;` | `mode: Mode \| undefined;`, `item: Item \| undefined;`, `unit: Unit2 \| undefined;`, `others: Map<string, Item2> \| undefined;`, `top: T \| undefined;` |
| `constructor(public size = 2)` | `public size;` | `public size: number;` |
| `n = 1;` | `n = 1;` | the same |
| `thing;` with a store of a class of a bundled package, or of a class that only another output has | `thing;` | the same |

**How it decides**

- A member gets a row if it is a property with no annotation that is not `declare` or `abstract`, or a parameter property with no annotation, in a checked module of the project. No option decides this. The writer sees what the bundle has: a field with its value needs nothing, a field with no value gets the type, and a member with no field gets a `declare` line. So a field that the parser moves for any reason is covered, and a change of that rule (#46553, #48593) changes which rows the writer uses.
- `Services::stated_type` is `ensureType` of the declaration emitter for one member: the type and the printer of `index.d.ts`, with these differences. A private member has a type. A parameter property is stated in the scope of its class, so a default adds no `undefined`. The absence of an optional member under `exactOptionalPropertyTypes` is left to the `?`. A literal that is not finite is `number`. A declaration that is not exported has its name. And the answer says that the text is refused when the printer left a part out: below ten levels of nesting, and for a type inside itself, where `index.d.ts` has `any`.
- A `readonly` member with a literal value is stated by its value: `declare readonly kind = "circle";`. With `: "circle"` a caller's `let kind = circle.kind` would be `"circle"` and not `string`.
- A text that has a word other than a keyword is parsed, all such texts of a module in one parse. The parse gives the place of each name. `stated_type` also returns the symbols that the printer named. A name counts only if it resolves, at the member, to one of those symbols or to what holds one (its enum, its namespace, its module). The printer writes `Uppercase`, `Lowercase`, `Capitalize` and `Uncapitalize` with no symbol: they count where the word is the global one.
- For a declaration with no name at the member the printer writes `import("./hidden").Hidden`. The author can write `shapes.Circle` behind a namespace import. The printer tells its tracker for which module it writes each `import("..")` (`SymbolTracker::track_import_type`). The name is what that module exports, or what the module of the namespace import exports, and `link` has a name for a declaration. The text is refused where the specifier stands for two modules that have the name, where the export is an alias merged with a type, and where the export has not the meaning of its place (a value for a type, a type behind `typeof`).
- A type parameter of the text itself (`<U>(value: U) => U`) stays as it is written, if nothing else of that name is in scope at the member.
- A name that is a variable in the bundle refuses the text: an enum below the top level, a namespace below the top level, a class or an enum of a namespace of the sources (the typed file has only the types of a namespace), `typeof` of such a namespace, and what `import X = N.Y` takes from one. Each block of a namespace is a function of its own in the bundle, so a name of another block refuses the text too. A value (`= Unit.Em`) needs an enum at its head. A computed key refuses the text. A namespace that no source declares (`Intl`, `NodeJS`) is a global name.
- `link` gives each name the name that the typed file has. A declaration that only another output has, or that the build removed, has no name there: the row is dropped. So is the row for an import of a package that the bundle holds, because the bundle has its own class for it. In a build with more than one output, a class that the typed file has only as a twin from the emitted declarations is no name either. A name that a binding below the top level would capture is written `outer.Item2`, as for an annotation. That holds for `import("./item").Item` too: the printer writes it where the bare `Item` is another declaration. A global that the bundle shadows is written `globalThis.Map`.
- `copy_slots` writes a row at a field of the bundle, unless the field has the value that it has in the sources. It writes no value there.
- `copy_members` writes a `declare` line for a member with no field, only with a type: an annotation or a row. The line has no `!` (TS1255). A private name gets no line (TS18019): the one field of that name in the class of the bundle gets the type, also where the source map has no place for that field.
- A member with no row has no line. If the bundle stores or reads it, the check of the typed file fails (TS2339) and the typed files are left out with the warning, as on main. Only a module under `// @ts-nocheck` gets a bare `declare n;`, which is `any`.
- A stated type brings the types and the imports that it names into the typed file, as an annotation does (the hoist queue of `link`). It brings no value.
- The bundle writes a member of an enum of another module as a constant with no place in its source map. `copy_casts` pairs such a value by the place of its store (the member that the build moved) or of its parameter, and the value gets its cast as a member of an enum in the same module does.
- A derived class with no constructor gets `constructor() { super(...arguments); }` from the build. Where every constructor of the base class takes no argument, that is what the sources say, and the writer gives `arguments` the type of the empty list for the check (TS2556 without). Where the base class takes arguments, `new HttpError("gone")` of a program would be an error against the typed file. The typed files are left out with `class HttpError inherits its constructor in the sources, and the build gives it one with no parameters`.

**Order with the other open PRs on this file**

- #48488: this branch has its commits and removes its member path, so #48488 is obsolete when this PR merges. With those commits this PR also carries the constants fix of #48485 (`text_that_names_nothing`) and the line of #48392 that writes no `!` behind `declare`. One of each pair has to go when they meet.
- #48466 rewrites the enum annotation in `copy_casts`, removes `linked.enum_names`, and gives a constant of an enum of another module a place in the source map. Both orders work. After #48466 the pairing by the place of a store finds nothing new and can go, with `Transfer::stated_slots`.
- #46553 and #48593 change which fields the parser moves. The table does not ask. Four tests here have the text of today's rule, and a static field that #46553 moves into a `static {}` block needs a look when both are in.
- #46383 (TypeScript 7.1 for `bun check`): this PR adds to `src/sema/check` one function beside `is_any_symbol_accessible`, one printer entry, four lines in the printer, and one method with an empty default body on the printer's tracker with three calls. It changes no signature there, and nothing in `src/bundler` or `src/runtime`.
- #48771 (the next AOT drop) rewrote `test/expected-durations.json` and `test/parallel-allowlist.json`, where this PR has one entry each. It is on main, and 3a69538da0 merges it.

**Limits that stay**

- A derived class with no written constructor whose base class takes arguments: no typed file, with the warning. `test.todo` has the wanted text. It needs the parameters of each constructor of the base class at the constructor that the build adds.
- A member with no row in a build that moves it: no typed file (TS2339), as on main. That is: a type that the printer cuts (below ten levels, or inside itself), a class that only another output has (`--splitting`), a class of a bundled package, a type of a package that the bundle does not import (`import type { Request } from "express"`, a name that the module does not import and the printer writes as `import("express").Request`, a class whose import the build removes), an enum or a class of a namespace, an enum of a function, a computed key in the type.
- A field that keeps its value and takes it from an enum of another module (`static shared = Mode.Slow`, and every such field where the build defines fields) is `string`, as on main. #48466 has the place that the cast needs. A field that keeps a value that `--define` replaced is typed by the new value too: `n = process.env.NODE_ENV` is `string` where the sources say `string | undefined`.
- `readonly #k = "lit"` keeps the type of its store (`string`), as on main.
- A stated type has the global types of the sources. `handle = setTimeout(..)` is `number` under `lib: ["dom"]`, and a program with other global types reads that.
- A TypeScript module that the check does not count as a project source (a workspace package that is imported by name, a `.ts` file in `node_modules`): no table, TS2339 as on main.
- A variable, a parameter or a return type that `--define` parts from its value: not in this table.
- A build that writes no `.aot.ts` file (`--minify-identifiers`, a format other than esm) fills the table too, as it makes the other `ModuleTypes` on main. A gate for that touches the entry points that #46383 changes.
- On Windows the check of the typed files does not find them (main). The tests that read the warning are `todoIf(isWindows)`, like the tests of main for that warning.

**For a maintainer to rule on**

- A package that is built with `useDefineForClassFields: false` states the option in its package.json, and `--aot` of a program lowers `index.aot.ts` with it a second time. A class that the bundle left with defined fields (a JavaScript input, a module under another tsconfig.json) is then lowered where `index.js` is not. That is so on main for an annotated field. This PR makes more such packages get typed files. The other design states define mode for every typed file.
- A member with no value has the type of the sources, and a store of the bundle that does not fit it leaves the typed files out. That is wanted where the typed file types the store wrongly: `pick(Defaults.size)` in the tests is `string` there for a number. It also takes the typed file from a package that bundles a compiled dependency and stores what its JavaScript returns. `req;` with `this.req = parse(text)` is `TS2322: Type '{ url: any; get(name: any): void; }' is not assignable to type '{ url: string; get(name: string): string | undefined; }'`, where main (89452d2ac1) writes `req;`. An annotated member has that error on main too. The other design writes the typed files again without the types at the fields that the bundle keeps, and then `size` is a string.
- The order of the open PRs on `typed_files.rs` (above).

**Measurements**

Debug builds of main (89452d2ac1) and of this branch before the merge of main, under `gdb` with breakpoint counts. Each cell: calls of the Rust allocator inside `module_types` / inside `add_types`, then the number of type-check passes (`check_request`).

| project | main | this branch | calls of `stated_type` |
| --- | --- | --- | --- |
| `sources` of `compile-library.test.ts`, 2 entry points, no class member without an annotation | 91 / 1,341, 2 | 90 / 1,341, 2 | 0 |
| 200 fields with a value, the build defines them | 24 / 667, 2 | 634 / 874, 2 | 200 |
| 200 members with no value, type `number`, stores kept | 24 / 1,104, 2 | 434 / 1,525, 2 | 200 |
| 200 members with no value, type is a class of the bundle, stores kept | 29 / 1,524, 2 | 3,019 / 2,546, 2 | 201 |
| `useDefineForClassFields: false`, 1 field with a value | 18 / 490, 3, no typed file | 25 / 497, 2 | 1 |
| the same, 20 fields | 21 / 544, 3, no typed file | 88 / 652, 2 | 20 |
| the same, 200 fields | 24 / 676, 3, no typed file | 634 / 1,691, 2 | 200 |
| the same, 200 fields whose value is `new Item()` | 29 / 1,102, 3, no typed file | 3,019 / 2,721, 2 | 201 |
| the 200 fields with `--minify-identifiers`, which writes no typed file | 24 / 0, 1 | 634 / 0, 1 | 200 |

- A build with no class member without an annotation makes the same allocator calls as on main. The first project counts 90 or 91 from run to run, with both builds.
- A field that keeps its value costs 3.1 + 1.0 allocator calls, and its text in the typed file does not change. That is the price of no option in the table: the writer drops the row when it sees the value.
- A member with no value costs 2.1 + 2.1 with a keyword type, and 15.0 + 5.1 with a type that has a name. A keyword text is not parsed. The texts with a name of one module are parsed together.
- A field that the build assigns costs 3.1 + 6.0 with a keyword type, and 15.0 + 11.1 with a type that has a name.
- A build that main leaves without typed files ran 3 type-check passes. It now runs 2.
- Release binary, linux-x64, `size`: text 143,094,946 on main (89452d2ac1) and 143,143,586 on this branch (+48,640). File: 143,284,496 and 143,333,648 (+49,152). The numbers of main are the ones that #48488 measured. Its head builds to the same bytes here as there (143,097,250).
- No change in `src/bundler` or `src/runtime`: the bundler and a build without `--dts` do what they do on the base.

**Two builds of 36 projects**

The same 18 projects, most with members that have no value and a store that `--define __DEV__=false` removes, built with main and with this branch, as they are and with `useDefineForClassFields: false`.

- The build defines the fields: both write all 18 typed files. `index.js` and every `.d.ts` are the same bytes. `bun check` with `index.aot.ts` as a source has no error that main does not have, and TS7008 is gone from 13 projects.
- `useDefineForClassFields: false`: main leaves 9 of the 18 without typed files (TS2339). This branch writes all 18, and `bun check` with `index.aot.ts` as a source has no error in any of them.

**Suites run**

Debug builds with ASAN. Main is 89452d2ac1, the base before the merge of main, with the tests of this branch.

| | main | this branch |
| --- | --- | --- |
| `test/aot/typed-file-unannotated-members.test.ts` | 7 pass, 19 fail, 1 todo | 26 pass, 1 todo |
| `test/aot/library-typed-file.test.ts` | 6 pass, 4 fail | 10 pass |
| `test/bundler/bun-build-dts.test.ts` | 11 pass, 9 fail | 20 pass |
| `test/bundler/bun-build-api-dts.test.ts` | 8 pass, 6 fail | 14 pass |
| `test/cli/compile/compile-library.test.ts` | 56 pass, 5 fail | 61 pass |

- `cargo test -p bun_sema_driver`: 290 pass. 12 are in `compile/tests/stated_members.rs`. `cargo test -p bun_sema`: 841 pass. `bun run rust:clippy` has no finding.
- `test/bundler/bun-build-dts.test.ts` needs `--timeout=120000` in a debug build on a small machine, on main too: its cases run at once. `compile-library.test.ts` ran with `--timeout=300000`.
- Also on this branch: `test/cli/compile/compile-library-aot-condition.test.ts` (13), `test/aot/typed-packages.test.ts` (5), `test/aot/library-from-npm.test.ts` (40), `test/cli/check/specifiers-in-declarations.test.ts` (3), `test/aot/ci-lists.test.ts` (1).
- After each merge of main (f84773225f, then d0f4fdd65f with #48771) the five files pass again, with 294 and 850 Rust tests. The debug build of main does not compile on this machine without the two includes of #48722 in `BunPlugin.cpp`, so those builds had them as a local change.
- After 83dbe8995b: 304 and 850 Rust tests, 22 of them in `compile/tests/stated_members.rs`. The new test file has 28 tests: 27 pass and 1 is a todo.
- Not run here: Windows, and the `mordant` lint, which is not on this machine. CI ran it: it passes on 990eee62f9, as `cargo clippy` and the source lints do.

**Reviews**

This work had four rounds of self-review, and the review on this PR.

- The first round asked for one mechanism for the type of an unannotated member, on #48488, and not a second producer beside its notes. That is this shape.
- The second round raised 12 points, and 10 were addressed then. The other 2 are done now: no fact from the bundler, and one PR (when main builds).
- The third round, of 6ff07aebbe, raised 48 points. 0936f9c8f7 addressed 36: a parameter property stated as `number | undefined`, a typed file with a constructor of no parameters for `class HttpError extends Error`, a second `declare #mode`, names that the typed file has as variables (`Shapes.Kind.Circle`, `Local.B`), `Uppercase` taken for an alias of the module, a bare `declare` whose store types the member in another way, and more. Of the 12 that were kept, 5 are done in this head: no fact from the bundler (2 points), a parameter property in a build that defines fields (2 points), and the names `outer.X` and `ns.Name` (1 point).
- The fourth round, of 0936f9c8f7, raised 38 points. This head addresses 22:
  - The bare `declare x;` for a member with no row typed the member by its stores, in a build that main refuses. It is gone. The rows for `import("./m").Name`, `ns.Name`, `outer.Name` and a type parameter of the text take its place.
  - The per-file fact from the bundler is gone, with its five files in `src/bundler` and the field of `TypeChecked`.
  - `by_name` on `is_any_symbol_accessible`, the state `has_elision` of the printer, and `check_and_emit_only_declarations` are gone: they met the signatures that #46383 changes. The limit of 4,000 bytes is gone: `index.d.ts` prints such a type in full.
  - `cargo clippy` failed on `.or(is_on(..))`, in a line that this head does not have.
  - A member that stores a class of a bundled package got the type that the package declares, and main's typed file was lost (TS2741).
  - `declare q: Inner.P;` for a namespace below the top level, and a name of another block of a namespace (TS2503, TS2304).
  - `Uppercase` was accepted where a symbol of that name was among the printer's symbols.
  - Tests for the arms that had none: an `import()` type, a type parameter of the text, a namespace of another block, a bundled package.
- 16 of the 38 are kept. 1 is for a maintainer: the option under which a program compiles the typed file. 4 were about main: the merge of main and the target of this PR are done in 139422b064, and 3a69538da0 merges #48771. 11 are limits that main has, under "Limits that stay", or work for another PR: one table for variables, parameters and return types (2 points), a table of what each lowering does to a typed file, the fixes of main's writer that #48488 carries (2 points), the place of `stated_type` in the API that `bun lint` shares, a check that refuses a name that the writer wrote and that does not resolve, the global types of the sources, a module behind a symlink or of a bundled workspace package, Windows, and the place of the test file under `test/aot`.
- The review on this PR found seventeen points. Seven are fixed in 6f57457618, cacff7849b and 6566b8120f. Three were on 6566b8120f: an annotated private field with no place in the source map, a private field with an enum of another module as its value, and the derived class. fd33a8f1f5 has the annotation at that field, the cast at the store, and a typed file for a derived class whose base class takes no argument. Six were on fd33a8f1f5, and the head has them: a byte search that the source lint forbids, `level: any;` for a member whose stores the build removed, `outer.Item` for `import("./item").Item` where a nested type has the name, a global namespace (`Intl.DateTimeFormat`) as a global name, the parsed specifier of an import in place of its text, and the reason at each `todoIf(isWindows)`. One more, on 990eee62f9, is a limit of main that stays: the type of a field whose value `--define` replaced.
- A second review on this PR found three points on 3a69538da0. Two are fixed in 1ff13bd120 and 86686fadef: a Rust test searched bytes with `slice::windows`, and the helper of the new test file dropped the exit code of `bun check`. The helper now expects 1 for a run that shows errors and 0 with no output for a run that shows none. The third asked for the new test file to go into an existing one. It stays: its thread has the reasons. One more point, on 86686fadef, is a limit that stays: a type of a package that the bundle does not import. Its thread has what a trial of the suggested rule cost. The last one, on e9be0ef5fc, is fixed in 609e5cab1d: `name_of_import_type` searched a quote with an iterator, and now uses `bun_core::strings`.
- The review on this PR then found a wrong name on 609e5cab1d: a member type that has `import("pkg").Request` and a source type `Request` was written with the source type for both. 83dbe8995b fixes it. Two rounds of self-review on that fix raised 27 points. 17 were against a first version that matched the specifier to the path of a source: that version is gone. 10 were against the printer's record: 9 are addressed (a refused export that counted as absent, the meaning of the name, the module of a specifier that the printer rewrites, the place of the name from the parse, one record for each pair, no work without a tracker, tests for each place that records, the wording of the commit), and 1 needed no change (four of the ten unit tests pass before the fix: they pin rules of the new lookup).

</details>

<!-- robobun:evidence:begin -->

---

**no test proof** · iteration 2 · platform-specific test(s) that do not run on this machine, deferring to CI, which covers all platforms: test/cli/compile/compile-library.test.ts, test/aot/typed-file-unannotated-members.test.ts, test/aot/library-typed-file.test.ts

<!-- robobun:evidence:end -->





