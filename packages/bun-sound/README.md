# bun-sound

Typed versions of npm packages, for `bun build --compile --aot`.

```
node_modules/react-reconciler/                 what npm installed; never touched
  index.js
  cjs/react-reconciler.production.js

.sound/react-reconciler/                       the typed version
  sound.json                                   what it fits, what it lays
  lay/index.js                                 replaces index.js, in memory, for this build
  lay/cjs/react-reconciler.production.ts       the same code with TypeScript types added
```

```sh
bun build --compile --aot --define 'process.env.NODE_ENV="production"' app.tsx
# note: "react-reconciler" 0.33.0 is compiled from its typed version in .sound/react-reconciler
```

The ahead-of-time compiler turns TypeScript types into machine-level facts: an object whose type is
known gets a fixed layout, and `fiber.flags` becomes a load at an offset. A package that ships plain
JavaScript gives it nothing to work with, so every property is looked up by name.

A typed version is **the package's own published file with type annotations added and nothing else
changed**. Strip the types and you get npm's bytes back; a gate proves that on every run. On our judges
a React update costs half the instructions (12,867 K to 6,571 K) and a TanStack Start render 10% fewer.

## Using one

One of these; the first that is there wins.

1. **In the project:** copy `<name>/<version>/sound.json` and `<name>/<version>/lay/` to
   `<project root>/.sound/<name>/`. Do not copy `src/`: its ambient `.d.ts` files would be picked up by
   your own tsconfig.
2. **In the package itself:** nothing to do. A package written in TypeScript and built with `bun build --dts`
   ships its own typed version: the first line of `index.d.ts` is `// @sound index.sound.ts <sha256 of index.js>`.
   It has no `sound.json`.
3. **As a dependency:** install the companion package (`@sound/<name>`, same version number as the
   package it types) and keep it listed in `dependencies` or `devDependencies`. A companion that is
   only there transitively is ignored.

Nothing on disk is modified. During an `--aot` build the bundler reads the files under `lay/` in place
of (or beside) the installed ones. `bun run`, `bun test` and builds without `--aot` never see them.

A typed version is used **all or nothing**. If anything does not fit, the package is compiled as
installed and you get one warning naming the first mismatch:

```
warn: the typed version of "react-dom" in .sound/react-dom is not used: it is for version 19.3.0, and 19.2.8 is installed (install the typed version for 19.2.8, or remove this one): the package is compiled untyped
```

### When the warning comes

The build goes on and the program is right; it is only not faster. What to do, by what the warning says:

| the warning says | do this |
|---|---|
| it is for version X, and Y is installed | install the typed version for Y: `bun add -d @sound/<name>@Y` (the two numbers are always the same). The versions that exist are the folders here. If there is none for Y: pin the package to X, or remove the typed version, or [carry](#carrying-a-typed-version-to-another-version) it to Y |
| the installed F differs from the published file that this typed version was made from | something changed `node_modules/<name>/F`: `patch-package`, `bun patch`, a postinstall script. A typed version fits npm's bytes only. Keep your own under `.sound/<name>/`, made from the patched file |
| it is for a build that defines process.env.NODE_ENV as "production" | pass `--define 'process.env.NODE_ENV="production"'`. In other builds the package's entry loads its development files, which are not typed |
| F is installed, and it was not when the package was typed | the package now ships a file at a path that the typed version adds. Treat it as another version |
| its sound.json is of a format that this Bun does not know | the typed version is newer than your Bun. Update Bun |

A package for which no typed version is installed is compiled as always, and nothing is said.

## sound.json

```json
{
  "sound": 1,
  "name": "react-reconciler",
  "version": "0.33.0",
  "when":  { "process.env.NODE_ENV": "production" },
  "basis": { "cjs/react-reconciler.production.js": "9eab580c…" },
  "lay":   { "cjs/react-reconciler.production.ts": "new",
             "index.js": "fc1202d3…" },
  "needs": []
}
```

| field | meaning |
|---|---|
| `sound` | format number, `1` or `2`. In format `2` a laid `.js`, `.cjs` or `.mjs` file holds TypeScript text: it replaces the installed file at its own path, so nothing about how modules find each other changes, and it is read as TypeScript. A Bun that does not know the format compiles the package as installed |
| `name`, `version` | must equal the installed package.json's, exactly |
| `when` | build-time defines that must have these string values. React's entries choose between a production and a development bundle on `NODE_ENV`; the typed text is the production one, so it only applies to production builds |
| `basis` | installed files that are *not* replaced but that the typed text was derived from: path to sha256. A patched package therefore never gets types written for other bytes |
| `lay` | path inside the package to either `"new"` (must not exist in the installed package) or the sha256 of the installed file it replaces. The replacement is `lay/<same path>` |
| `needs` | names of other packages whose typed version must also be in use |

Paths are relative, use `/`, and may not contain `..`. `package.json` cannot be laid.

## What is in this folder

```
<name>/<version>/
  package.json  sound.json  lay/               what gets published
  LICENSE  NOTICE                              published too: the package's own licence; whose code it is and what was changed
  lay.sums                                     sha256 of every file under lay/
  src/                                         what lay/ is generated from: the typed text + its shapes
  family.json                                  instead of lay/ and src/: this version is another one with its version string changed
check.py      static gates; also regenerates lay/ from src/ and compares
run.py        builds and runs the test trees: typed against untyped against plain Bun
pack.py       diffs an installed tree against a laid one and writes a <name>/<version>/ folder
publish.py    writes the tarballs to publish, from this folder alone
carry.py      moves the types to another version of the same file, line by line
sabotage.py   breaks the text in one way per gate and checks that the gate notices
tools/        the steps check.py calls, and the tools for writing a new typed version
trees/        test programs: client (reconciler), server (react-dom/server), seroval, entries
```

Environment for all of them:

```sh
export SEMA=/path/to/bun-sema            # the type checker's CLI, built from src/sema
export BUN=/path/to/bun                  # any Bun; used only to print files in a normal form
export BUN_SEMA_TS_LIB=/path/to/typescript/lib
```

The gates work on packages as npm installs them. `trees/installs/<set>/package.json` pins what each tree was last run with:

```sh
cd trees/installs/client && bun install      # client, server-19.3.1 .. server-19.0.0, seroval, fuse, sdk-0.112.1, sdk-0.128.0
```

```sh
python3 check.py  path/to/node_modules out/                     # static; a few seconds
python3 run.py build   path/to/aot-bun path/to/node_modules out/   # compiles the trees
python3 run.py answers path/to/aot-bun path/to/node_modules out/   # runs them and compares
```

### The gates

`check.py`, per package found in that `node_modules`:

| gate | fails when |
|---|---|
| md5 | the installed file is not the one the text was written for |
| errors | the typed text has a type error |
| verify | the text with types stripped, printed by Bun, differs from npm's file printed by Bun |
| splits | a variable that was split into roles (see below) is read in one role where a store to another role can reach it. `verify` cannot see this; it strips the suffixes |
| counts | the number of role variables drifted |
| form, clean, entry | the mechanical steps from `src/` to `lay/` do not round-trip |
| laid | a file under `lay/` has an error when checked where it lies, under `--strict` |
| lax | a file under `lay/` has an error under `noImplicitAny: false`, `strictNullChecks: false` or `strict: false`. Those two options of the user's tsconfig reach a package |
| fields | a class field the text adds is not `declare`d |
| changed | (Apache-2.0 packages) the typed file does not say on its first line that it was changed |
| same | `lay/` (or `lay.sums`) is not byte for byte what `src/` gives, or a sha256 in `sound.json` is not the installed file's |

`run.py` answers the question the static gates cannot: *are the types true?* Each tree is a long list of
scenarios, each in its own `try`, printing what the package produced. The same source is run plainly on
the untouched package (twice, to prove it is deterministic), compiled with `--aot` untyped, typed, and
typed with `BUN_JSC_auditAOTTypedAssertions=1` at the build (a value that contradicts its type is reported instead of thrown).
Every scenario must print the same text in every column. `trees/entries` asks each replaced entry what it
is to its importers: `require()`, `import d`, `import * as ns`, named imports including a name nobody exports.

`run.py build` has one more gate, **facts**. A typed version can compile, give every right answer, and still have lost what it
is for: the compiler may decide that the package's records could come from outside and give them no layout. That has happened:
one change in the compiler, together with an ES-module entry, made the typed reconciler slower than the untyped one with every
other gate green; another made every `Fiber` admit foreign objects, through the small records that hold one, for 16% more
instructions. Both were found by an application's benchmark. So `run.py build` takes three measures of each tree's typed program,
all of them the compiler's own, and `FACTS` in `run.py` pins them:

| measure | from | fails when |
|---|---|---|
| offset | `tools/facts.py` on the compiler's intermediate form: of the reads and stores of a property in the package's own functions, how many go by offset | two points down |
| bytes | the image's map: the package's compiled bodies, typed over untyped | a tenth up |
| strangers | `--aot-explain=foreign`: the named records whose layout admits foreign objects | a new name |

```
ok   server: facts: react-dom: 64.0% of the reads and stores of a property in its own functions go by offset (due 64.0) · its compiled bodies: typed / untyped bytes 0.965 (due 0.965)
FAIL server: facts: react-dom: 51.2% ... (due 64.0) · ... bytes 1.13 (due 0.965) · WORSE: offset bytes: THE TYPED VERSION HAS LOST FACTS ON THIS COMPILER
```

The percent counts the package's own functions and not the whole program, which holds Bun's built-in modules too.

A loss that is known and not yet mended stands in `opened`, by tree: the records that were closed when the package was typed and
admit foreign objects on today's compiler. `run.py` names them at every run, fails on one name more, and says so when one is closed
again.

A tree must give the compiler the chance to go wrong: scenario 29 of the client tree reads JSON into small records under the names
that the reconciler's own small records have (`{ current }`, `{ pending }`, `{ then }`). Without it the second loss does not show.

To see which records lost their layout, print the compiler's intermediate form and count by package:

```sh
cd out/rooms/fuse.born/typed && $SEMA cli wide.ts --snapshot=snapshot --aot > ir.txt && python3 tools/facts.py ir.txt fuse.js
# facts fuse.js: 322 of 696 (46.3%) reads and stores are by offset · records 41, foreign 14
$SEMA cli wide.ts --snapshot=snapshot --aot --aot-explain=alterations | grep given
```

## Making a typed version of a new package

Pick the file that actually runs (the production bundle, not the sources: that is what users have).

```sh
mkdir work && cd work
cp ../node_modules/seroval/dist/index.js original.js
echo '{ "module": "esm", "shapes": "sv", "space": "SV" }' > project.json   # "cjs" for a CommonJS bundle
python3 ../tools/births.py > births.txt        # every object literal and constructor, by its members
python3 ../tools/piecework.py split            # pieces of about 480 lines, cut at top-level declarations
```

1. **Shapes first.** One person (or agent) writes `sv-shapes.d.ts`: `declare namespace SV { … }` with one
   interface for every object the file *creates and keeps* (`births.txt` lists them all), members in the
   order the literal writes them, each with the honest type of everything ever stored to it.
2. **Annotate in pieces.** `piecework.py take 3` creates `parts/03.mts`; edit that. `errors 3` type-checks the
   whole file (under a second) and shows the errors in piece 3; `bang 3` adds `!` wherever the checker says
   "possibly null"; `verify` must keep saying PASS. Pieces are independent, so this parallelises: we gave
   each piece to one LLM agent, then ran rounds over the pieces that still had errors.
   `recipe/type-a-package.workflow.js` is that script.
3. **Write a test tree.** Walk the package's public API with every kind of input, including malformed input
   and input that came through `JSON.parse`. Print results without using the package.
4. **Add the package to `check.py`'s table**, run the gates, `pack.py`, run the tree.

### The rules that matter

Only types are added: annotations, `!`, casts, `this:` parameters. No statement, name, order or literal
changes, and no comments. Anything *inserted* stands between markers so that `verify` can remove it:
`x/*$*/ as SV.Node/*$*/`.

**Born or given.** An interface means a fixed layout. That is right for objects the file itself creates
and wrong for anything other code can hand in: options bags, user values, callbacks, props, data out of
`JSON.parse`. Type those `any` through a named alias (`type Options = any`) in a section headed `// GIVEN`.
A plain object that reaches a place typed as a layout is converted or refused at run time; either way it is
slow or wrong.

**The type must say what really arrives.** seroval's nodes are created with twelve members, but a node
that went through JSON has two to six, because JSON drops `undefined`. With the members required, such a
tree was refused; with eleven of them optional it is accepted, at no measurable cost.

**One shape per layout.** If fifty "kinds" of node are created by one literal, that is one interface, not
a union of fifty. Never write a union of two created shapes on a variable.

**Small integers** (`type int32 = import("bun").int32; type Flags = int32`) are kept in four bytes. The compiler declares that type itself, whatever `bun-types` is installed; an alias of your own that is only called `int32` is a number. Storing anything else
there throws, so a number that comes from outside is not an `int32`.

**A literal with no declared type is a trap.** `{ next: null }` gets a field that can only hold `null`.
Every literal with a `null`, `undefined` or constant member that is filled in later needs a declared type.

**A class field you add is `declare`d.** `class Stream { /*$*/declare buffer: SV.Given[]; declare alive: boolean;/*$*/` emits
nothing. Without `declare` the field is a definition and the property exists before the constructor stores to it.

**Minified bundles reuse variables.** Closure-compiled code stores a fiber, then a number, then a queue in the
same `var a`. Give each role its own marked variable and write the suffix at every store and read of that role;
`verify` strips `$as[A-Z]\w*`, and the `splits` gate proves the split follows the data flow:

```ts
function f(a: RR.Fiber) { /*$*/var a$asQueue: RR.UpdateQueue;/*$*/
  a$asQueue = a.updateQueue;      // npm: a = a.updateQueue;
  return a$asQueue.shared;        // npm: return a.shared;
```

**A variable with two roles opens the records it holds.** A variable without a written type gets the union of everything that is
stored to it. If one role is `any` (an error, a prop, a child) and another is a record, then `any` reaches the record, and the record and
all that it holds admit foreign objects: every read of them gets a shape test and a slow path. Ten such variables made typed react-dom 10%
larger than the untyped package. `--aot-explain=foreign` names the first such place for each record. Give every role its own variable and
write its type.

**Cast a constructor function without `unknown`.** `new (F as unknown as FConstructor)(..)` hands `F` to `unknown`, and whoever holds an
`unknown` may call it with anything, so the records among its parameters, `this` included, admit foreign objects. Give the constructor's
type the function's own call signature next to the construct signature. It is then assignable to the function's type, and TypeScript accepts
`F as FConstructor`:

```ts
interface RequestConstructor { new (state: State): Request; (this: Request, state: State): void }
function RequestInstance(this: Request, state: State) { this.state = state; }
var request = new (RequestInstance as RequestConstructor)(state);
```

**Hand records out as `any`.** A record type in the result of a function that a JavaScript file imports, or that a JavaScript entry exports
again, counts as data from outside: JavaScript may store anything to an object it is handed. The compiler then gives the type up in the whole
program: its objects are made as plain objects, and the typed code reads them by name too. seroval's `toJSON` and `toCrossJSON` said that they
return a `SerovalNode`, and in a TanStack Start server no node had a layout. Written as `any`, the same object is merely let out and keeps its
layout. `--aot-explain=alterations` counts such types under "given".

**Say what is frozen.** Of `Object.freeze(x)`, `Object.seal(x)` or `Object.preventExtensions(x)` with an `x` of type `any` the compiler has to
assume that `x` may be any laid-out object of the whole program. Every layout then counts as one that may be frozen, and every store to a
field tests for it: 807 of the 3,520 stores in a TanStack Start server, react-dom's among them, for one line of seroval. Give the operand the
type of what really arrives. `--aot-explain=alterations` names the first such place under "integrity level".

**Do not lean on the host project.** The text is checked under the user's tsconfig. Without `noImplicitAny`
TypeScript has no evolving types (`var x;` and `var x = null` are plain `any`), and without `strictNullChecks` a union cannot be
told apart by `null`: so write the type on every variable and give each role its own. Declare every global that
is newer than ES2020 or belongs to a host (`declare var Temporal: any;`), and reach for members the standard
library may lack through a marked cast.

**Entries stay CommonJS if they were.** `tools/cjs_entry.py` keeps npm's own entry text, resolves its
`NODE_ENV` switch to the production arm and points `require('./cjs/x.js')` at `x.ts`. An ES-module entry would
turn `import { nameThatDoesNotExist }` from `undefined` into a build error and change what `require()` returns.

**A small CommonJS file is typed where it lies.** In format `2` the typed text takes the place of `cjs/x.production.js` at that path and keeps
its `exports.name = ..`. The entry, and how an importer finds `name`, stay npm's own, so `import { c } from "react/compiler-runtime"` is still
resolved when the program is built. Through an entry that hands on the `default` of a typed ES module the importer holds an object and looks
`c` up by name at every call, some 25 instructions more. `PLACED` in `check.py` lists these files. They are kept as `.cts` under `src/`, and
`check.py` writes them to `<out>/sound/<name>/`, not into `<out>/node_modules`, where a `.js` file would be read as JavaScript.

**So is a CommonJS bundle of which a program uses a part.** The compiler drops an export of a CommonJS module that nobody reads, and all that
only it reaches. An entry that hands on the `default` of a typed ES module holds every export alive. `react-dom/server` loads two bundles
and takes two functions of the legacy one: as ES modules the typed bundles were 221 KB (5%) more compiled code in a TanStack Start server
than they are at npm's own paths, and more than the untyped package. A door in a dead export goes with it: `FormatContext` was open for
`resumeRequest` alone. These rows have `form='placed'` in `check.py`: the typed text, with the shapes of the ES form behind it.

**Never lay `x.ts` beside `x.js` when there is an `x.d.ts`.** The checker prefers `x.ts`, and the package's
public types vanish for its users. Name it `x.sound.ts` (seroval: `dist/index.sound.ts`, and `dist/index.js`
becomes `export * from "./index.sound.ts";`).

**Mind what your test tree does to the subject.** The compiler judges the whole program. One
`fromJSON(JSON.parse(text))` in seroval's tree made it treat every node as outside data, so the tree tested a
program with no layouts at all. `trees/seroval/wide.ts` is therefore cut into three programs.

## Carrying a typed version to another version

```sh
python3 carry.py react-dom/19.3.0/src/server.bun \
    old/node_modules/react-dom/cjs/react-dom-server.bun.production.js \
    new/node_modules/react-dom/cjs/react-dom-server.bun.production.js  out/
```

A line that is identical in both versions keeps its types; a changed line comes in bare. `carry.py` then prints
the three gates. From 19.3.0 to 19.2.8, 5,919 of 6,745 lines kept their types, leaving 142 type errors and 10
broken role splits (a kept line stores `x$asRole`, the bare line after it reads `x`; only `splits` sees that).
Mend `out/typed.cts` by hand or with `recipe/mend-after-carry.workflow.js`, `carry.py … --again` to re-read the gates,
then run the tree against the new version.

Patch releases often differ only in their own version string. Those are kept as one text: see `versions` and
`token` in `check.py`'s table. Only the newest has `lay/` in this tree; the others keep `sound.json`, `lay.sums` and
`family.json`, and `publish.py` generates the rest and checks it against `lay.sums`.

## Publishing

```sh
python3 publish.py pack out/                        # every typed version; or name some: react-dom@19.2.4
# sound-react-dom-19.2.4.tgz    9 files   412345 B  5f0c...
npm publish out/sound-react-dom-19.2.4.tgz --access public
```

`pack` needs Python 3 and this folder, nothing else: no network, no `node_modules`, no compiler. It sends nothing. It refuses to
write a tarball whose manifest, `package.json` and folder name disagree, whose `lay/` is not byte for byte what `lay.sums` pins, or
that names a path of the machine it was made on. Run twice it writes the same bytes; `out/SUMS` lists them.

Before publishing a version for the first time, run the gates on the package as npm installs it:

```sh
python3 publish.py gates react-dom path/to/node_modules out/
python3 run.py build   path/to/aot-bun path/to/node_modules out2/ && python3 run.py answers path/to/aot-bun path/to/node_modules out2/
```

`test/bundler/compile-aot-bun-sound.test.ts` checks every manifest, licence file and pinned sum in this folder on each CI run.

## Licences

A typed version is a copy of the package's code, so it is published under the package's licence, with the package's `LICENSE`
file as installed and a `NOTICE` that says whose code it is and what was changed.

| package | licence | copyright | what the licence asks of a changed copy | where |
|---|---|---|---|---|
| react, react-dom, react-reconciler | MIT | Meta Platforms, Inc. and affiliates | keep the copyright and permission notice | `LICENSE`; the `@license` header stays in each file |
| seroval | MIT | 2025 Alexis Munsayac | the same | `LICENSE` |
| @anthropic-ai/sdk | MIT | 2023 Anthropic, PBC | the same | `LICENSE` |
| fuse.js | Apache-2.0 | 2023 Kiro Risk | a copy of the licence; keep the notices; changed files say that they were changed; pass on `NOTICE` if there is one (there is none) | `LICENSE`; the header stays; the first line of `lay/dist/fuse.sound.ts`; `NOTICE` |

`pack.py` stops on a package without a `LICENSE` file or a copyright line. For a licence that is not in this table, read it first.

## Known differences from the untyped package

- seroval: `compileJSON()` of a tree that violates seroval's own declared types (a string, a node without `t`,
  an id that is not a number) throws a `TypeError` where npm's text throws its own error or emits what it can.
- A `Proxy` wrapped around an object that a typed version creates (Vue's `reactive(new Fuse(list))`) is refused as the receiver of
  that object's methods: a `TypeError` where npm's text works through the Proxy. This is the compiler's rule for every typed class.
- A typed version applies to production builds only (`when`).
