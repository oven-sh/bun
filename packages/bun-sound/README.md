# bun-sound

Typed versions of npm packages, for `bun build --compile --aot`.

```
node_modules/react/                                what npm installed; never touched
  compiler-runtime.js
  cjs/react-compiler-runtime.production.js

.sound/react/                                      the typed version
  sound.json                                       what it fits, what it replaces
  lay/cjs/react-compiler-runtime.production.js     the same code with TypeScript types added: replaces the
                                                   installed file, in memory, for this build
```

```sh
bun build --compile --aot --define 'process.env.NODE_ENV="production"' app.tsx
# note: "react" 19.3.1 is compiled from its typed version in .sound/react
```

The ahead-of-time compiler gives objects a fixed layout, and where it knows which objects reach
`fiber.flags`, that read is a load at an offset. In a package that ships plain JavaScript it knows only
what it can prove by following each object from the place that creates it. Where the proof fails, the
property is looked up by name. With a declared type, a guard checks a value once, where it reaches the type, and the
code behind the guard relies on the type.

A typed version is **the package's own published file with type annotations added and nothing else
changed**. Erase the types and you get npm's code back: a gate proves that on every run, and the compiler
proves it again in every build. The compiler doesn't accept every typed version in this folder yet: see
[What the compiler accepts](#what-the-compiler-accepts).

## Using one

One of these; the first that is there wins.

1. **In the project:** copy `<name>/<version>/sound.json` and `<name>/<version>/lay/` to
   `<project root>/.sound/<name>/`. Do not copy `src/`: its ambient `.d.ts` files would be picked up by
   your own tsconfig.
2. **In the package itself:** nothing to do. A package can ship its own typed version: `index.aot.ts` beside
   `index.js`, named by the `"bun-aot"` condition of its `exports`. It has no `sound.json`.
3. **As a package of its own:** `node_modules/@oven/sound-<name>/`, with the same `sound.json` and `lay/`. For `@scope/name`
   that is `@oven/sound-scope__name`. This is what `publish.py` packs. Bun looks in the `node_modules` of the project root,
   then in that of each folder above it.

Bun looks nowhere else.

Nothing on disk is modified. During an `--aot` build Bun reads each file under `lay/` instead of the installed
file at the same path. Without `--aot`, `bun run`, `bun test` and `bun build` never see them.

What `sound.json` pins is **all or nothing**. If anything does not fit, the build stops with an error naming the
first mismatch. A program never gets slower without you hearing about it:

```
error: TS100056: The typed version of "react-dom" in .sound/react-dom can't be used: it is for version 19.3.0, but 19.2.8 is installed. Replace it with the typed version for 19.2.8, or remove it
```

The code is compared file by file. A typed file that is not the installed file with types added gets the same
error. What a package ships for itself (2 above) is not yours to repair: there the same sentence is a warning, and the
installed file is compiled.

### When the error comes

What to do, by what the error says:

| the error says | do this |
|---|---|
| it is for version X, but Y is installed | replace it with the typed version for Y. The versions that exist are the folders here. If there is none for Y: pin the package to X, or remove the typed version, or [carry](#carrying-a-typed-version-to-another-version) it to Y |
| it needs process.env.NODE_ENV to be defined as "production" | pass `--define 'process.env.NODE_ENV="production"'`, to `bun check --aot` as to the build. In other builds the package's entry loads its development files, which are not typed |
| this version of Bun doesn't support the "sound" version in its sound.json | `"sound"` is not `2`. Format `1` is no longer read: see [What the compiler accepts](#what-the-compiler-accepts). A higher number is newer than your Bun: update Bun |
| it adds F, and a typed version can only replace installed files | `"lay"` says `"new"` for F. Add the types to the installed file, at its own path |
| lay/F is missing | `"lay"` lists F, and there is no such file under `lay/`. Copy the whole `lay/` folder |
| it needs the typed version of "P", which is not used | `"needs"` lists P. Copy P's typed version to `.sound/P/` too. If it is there, the build has an error about it as well |
| lay/F without its types doesn't match F | the typed file changes code: a name, a literal, an operator, one statement more or less. Only types may be added. Or something changed `node_modules/<name>/F`: `patch-package`, `bun patch`, a postinstall script. A typed version fits npm's code only: see [A package that the project patches](#a-package-that-the-project-patches) |
| in lay/F, TypeScript syntax that emits code can't be erased | the typed file has an `enum`, a `namespace` that is not `declare`d, a parameter property, a decorator, an `accessor` field, JSX, `import x = require()` or `export =` |

A package for which no typed version is installed is compiled as always, and nothing is said.

## sound.json

```json
{
  "sound": 2,
  "name": "react",
  "version": "19.3.1",
  "when":  {},
  "lay":   { "cjs/react-compiler-runtime.production.js": "f7d518f5…" },
  "needs": []
}
```

| field | meaning |
|---|---|
| `sound` | format number: `2`. A file under `lay/` holds TypeScript text under the name of the installed `.js`, `.cjs` or `.mjs` file. It replaces that file at its own path, so nothing about how modules find each other changes, and it is read as TypeScript. Any other number stops the build |
| `name`, `version` | must equal the installed package.json's, exactly |
| `when` | build-time defines that must have these string values: `{ "process.env.NODE_ENV": "production" }` |
| `lay` | path inside the package to the sha256 of the installed file it replaces. The replacement is `lay/<same path>`. The compiler doesn't compare the sum: it compares the code, node for node. The gates of this folder compare it |
| `needs` | names of other packages whose typed version must also be in use |
| `compilerOptions` | optional: the options that the files under `lay/` are type checked under, as in a tsconfig.json. Without it: `strict`, and nothing more |

Paths are relative, use `/`, and may not contain `..`. `package.json` cannot be replaced.

The manifests in this folder also have `"basis": {}`. The compiler doesn't read that member. `pack.py`, `publish.py` and
`test/bundler/compile-aot-bun-sound.test.ts` still ask for it.

## What the compiler accepts

The compiler relies on no gate of this folder. In every build it parses each typed file that the program loads, parses the installed
file, and compares the two trees node for node with the types erased (`src/sema/erasure.rs`). White space and comments do not
count. So what is compiled is the code that `bun run` would load.

| | |
|---|---|
| erased | annotations, type parameters and type arguments, `as`, `satisfies`, `!`, `this:` parameters, interfaces, type aliases, type-only imports and exports, overload signatures, and whatever is `declare`d, class fields included |
| not erased | TypeScript syntax that emits code: an `enum`, a `namespace` that is not `declare`d, a parameter property, a decorator, an `accessor` field, JSX, `import x = require()`, `export =`. In a CommonJS file also an `export` of a type, which would make it an ES module |
| has to be the same | everything else: each statement, name, literal and operator, in the same order |

A typed version that changes more than types stops the build with the error above, until it is written again: at npm's own paths, with
nothing but types added. The typed versions in this folder keep to the rule: react, react-reconciler, @anthropic-ai/sdk, react-dom 19.3.0
and 19.3.1, seroval.

`one_name.py` makes `lay/` of react-reconciler, react-dom 19.3.0 and 19.3.1, seroval and @anthropic-ai/sdk from the same `src/`:
see [A variable that the bundle reuses](#a-variable-that-the-bundle-reuses). `check.py` and `run.py` still generate and measure all of them in the old form. `check.py` writes the format `1` files into its copy of the packages,
`<out>/node_modules`, where they are ordinary TypeScript files of the package, so those trees say nothing about `.sound/`.
[What the compiler no longer accepts](#what-the-compiler-no-longer-accepts) has the rules that every `src/` was written by.

## What is in this folder

```
<name>/<version>/
  package.json  sound.json  lay/               what gets published
  LICENSE  NOTICE                              published too: the package's own licence; whose code it is and what was changed
  lay.sums                                     sha256 of every file under lay/
  src/                                         what lay/ is generated from: the typed text + its shapes
  family.json                                  instead of lay/ and src/: this version is another one with its version string changed
check.py      static gates; also regenerates lay/ from src/ and compares
one_name.py   makes lay/ in format 2 from a src/ that changes more than types, with gates of its own
run.py        builds and runs the test trees: typed against untyped against plain Bun
pack.py       diffs an installed tree against a generated one and writes a <name>/<version>/ folder, in format 2
publish.py    writes the tarballs to publish, from this folder alone
carry.py      moves the types to another version of the same file, line by line
sabotage.py   breaks the text in one way per gate and checks that the gate notices
tools/        the steps check.py and one_name.py call, the tools for writing a new typed version, and those that say where a typed build spends its time
trees/        test programs: client (reconciler), server (react-dom/server), seroval, sdk, entries, lie
```

Environment for all of them:

```sh
export SEMA=/path/to/bun-sema            # the type checker's CLI, built from src/sema
export BUN=/path/to/bun                  # any Bun; used only to print files in a normal form
export BUN_SEMA_TS_LIB=/path/to/typescript/lib
```

The gates work on packages as npm installs them. `trees/installs/<set>/package.json` pins what each tree was last run with:

```sh
cd trees/installs/client && bun install      # client, server-19.3.1, server-19.3.0, seroval, sdk-0.112.1, sdk-0.128.0
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
| laid | a file under `lay/` has an error when it is checked at its path in the package, under `--strict` |
| lax | a file under `lay/` has an error under `noImplicitAny: false`, `strictNullChecks: false` or `strict: false`. Those two options of the user's tsconfig reach a package |
| fields | a class field the text adds is not `declare`d |
| changed | (Apache-2.0 packages) the typed file does not say on its first line that it was changed |
| same | `lay/` (or `lay.sums`) is not byte for byte what `src/` gives, or a sha256 in `sound.json` is not the installed file's |

`run.py` answers the question the static gates cannot: *are the types true?* Each tree is a long list of
scenarios, each in its own `try`, printing what the package produced. The same source is run plainly on
the untouched package (twice, to prove it is deterministic), compiled with `--aot` untyped, typed, and
typed with `--aot-log-type-mismatches` at the build (a value that doesn't match its declared type is logged).
Every scenario must print the same text in every build. `trees/entries` asks each replaced entry what it
is to its importers: `require()`, `import d`, `import * as ns`, named imports including a name nobody exports.

`run.py build` has one more gate, **typedness**. A typed version can compile, give every right answer, and still have lost what it
is for: the compiler may decide that the package's records could come from outside and give them no layout. That has happened:
one change in the compiler, together with an ES-module entry, left the typed reconciler slower than the untyped one with every
other gate green; another opened `Fiber`, through the small records that hold one, for 16% more
instructions. Both were found by an application's benchmark. So `run.py build` takes three measures of each tree's typed program,
all of them the compiler's own, and `PINS` in `run.py` pins them:

| measure | from | fails when |
|---|---|---|
| typed_percent | the first line of `--explain=json`: of the property accesses in `node_modules`, how many are a load or a store at a fixed offset (`dependencyPercent`) | two points down |
| bytes | the image's map: the bytes of the package's compiled functions, typed over untyped | a tenth up |
| expected_open | `--explain=json`: the named types of the causes whose `family` is `unknown-code` or `unproven-type`: objects without the type's layout can be there | a new name, or more causes that name no type than `unnamed_open` pins (0 unless pinned) |

```
ok   server: typedness: react-dom: 64.0% of the property accesses in node_modules are at a fixed offset (pinned 64.0) · bytes of its compiled functions, typed / untyped: 0.965 (pinned 0.965)
FAIL server: typedness: react-dom: 51.2% ... (pinned 64.0) · ... 1.13 (pinned 0.965) · worse: typed_percent bytes: the typed version is less typed than pinned (which types: bun compile --explain)
```

The percent counts everything under `node_modules`, not the tree's own file and not Bun's built-in modules. A typed build that prints
no report fails the gate, and nothing is compared.

A regression that is known and not yet fixed is listed in `regressed_open`, by tree: the types that were closed when the package was
typed and are open on today's compiler. `run.py` names them at every run, fails on one more name, and says so when one is no longer
listed: it is closed again, or it has lost its layout and is read by name, and then `typed_percent` falls.

The report names classes, constructor functions, interfaces and type aliases. Only an object type that was written without a name has
none. More causes that name no type than `unnamed_open` pins fail the gate: a type that is not listed may then still be open.

A tree must give the compiler the chance to go wrong: scenario 29 of the client tree reads JSON into small records under the names
that the reconciler's own small records have (`{ current }`, `{ pending }`, `{ then }`). Without it the second regression does not show.

To see which types are not closed, and why:

```sh
cd out/projects/seroval.internal/typed && bun compile wide.ts --explain
bun check --aot wide.ts --explain=unknown-code --explain=unproven-type --explain=mutation 2>&1 | grep '^aot: '   # one line per type and reason
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

1. **Shapes first.** One person writes `sv-shapes.d.ts`: `declare namespace SV { … }` with one
   interface for every object the file *creates and keeps* (`births.txt` lists them all), members in the
   order the literal writes them, each with the honest type of everything ever stored to it.
2. **Annotate in pieces.** `piecework.py take 3` creates `parts/03.mts`; edit that. `errors 3` type-checks the
   whole file (under a second) and shows the errors in piece 3; `bang 3` adds `!` wherever the checker says
   "possibly null"; `verify` must keep saying PASS. Pieces are independent, so this parallelises: we gave
   each piece to one person, then ran rounds over the pieces that still had errors.
3. **Write a test tree.** Walk the package's public API with every kind of input, including malformed input
   and input that came through `JSON.parse`. Print results without using the package.
4. **Add the package to `check.py`'s table**, run the gates, run the tree. For a file in `PLACED` and a package with
   `form='placed'`, `check.py` writes `sound.json` and `lay/` in format `2` to `<out>/sound/<name>/`. `pack.py` writes format `2` too.

### A package of many small files

koa, @koa/router, delegates, on-finished, ee-first, parseurl, express, router, finalhandler, body-parser and fastify have no `src/`: each file
under `lay/` is the installed file, edited in place. They are not in `check.py`'s table. `pack.py` pins their sums, and every build proves that
they are the installed code and that they type check: `AOT_SERVERS=koa-typed,express-typed,fastify-typed bun test test/aot/servers`.

```sh
mkdir -p .sound/koa/lay/lib && cp node_modules/koa/lib/request.js .sound/koa/lay/lib/
cp .sound/koa/lay/lib/request.js work/request.ts                        # the build names only the first error: check a copy by itself
bun check --aot --all --no-pretty work/request.ts | python3 tools/implicit_any.py .sound/koa/lay/lib/request.js
```

- `require` returns `any`, so the types of a package are declared again at the end of each file (`declare namespace KT { .. }`), and what
  another file exports gets its type where it is required: `const Layer: RT.LayerConstructor = require('./layer')`.
- An accessor can't declare `this`. `module.exports = { get url () { .. } } satisfies ThisType<KT.Request>` types it for a whole literal.
- A function that is called with `new` declares `this`, and `new F()` inside the file is `new (F as unknown as Constructor)()`.
- Symbols as keys: `declare const FS: { readonly kReply: unique symbol }`, `const { kReply }: typeof FS = require('./symbols')`,
  `interface Reply { [FS.kReply]: .. }`.
- In a file without semicolons, a cast at the start of a line continues the line above. `;(error as any).status = 400` is the same code behind
  an expression. Behind a block it is one empty statement more, and the file no longer matches.
- A function that reads `arguments` gets an overload signature. A rest parameter changes the code.
- An ES module needs `// @ts-ignore` above an `import` of a package without types.
- Never write `: any` where the file's JSDoc says more. The compiler reads `@param {number} status` in a plain `.js` file as the type to expect, and
  an annotation replaces it: `status: any` is less than the untyped file had.

What these buy is in `test/aot/servers/measure` (`koa-typed`, `express-typed`, `fastify-typed`). A type helps where the file itself creates the
object with `new`, a class or a literal. It doesn't where the object comes from `Object.create(prototype)`, is one of node's own with names added
or its prototype replaced, or is a function with members.

### The rules that matter

Only types are added: annotations, `!`, casts, `this:` parameters. No statement, name, order or literal
changes, and no comments. Anything *inserted* stands between markers so that `verify` can remove it:
`x/*$*/ as SV.Node/*$*/`.

**Allocated here or passed in.** An interface means a fixed layout. That is right for objects that the file itself
allocates and wrong for anything that other code can pass in: options bags, user values, callbacks, props, data out of
`JSON.parse`. Type those `any` through a named alias (`type Options = any`), in a section of their own.
A plain object that reaches an interface type doesn't have the layout. Nothing is converted or copied and nothing throws: the guard
at that place fails, and the function goes on in its slow version. The type is then no longer proven where such a value can get to:
every read through it there tests the shape first and has a slow path.

**The type must say what really arrives.** A value of another type than the one you wrote throws nothing and changes no answer. The
guard that it meets fails, and the function goes on in its slow version, which does what npm's file does. So a wrong type costs what the
typed version was written to win, and no test of the package notices: `--aot-log-type-mismatches` logs each one. A member that is
missing is no mismatch: it reads as `undefined`, and `undefined` and `null` pass every type. seroval's nodes are allocated with twelve
members, but a node that went through JSON has two to six, because JSON drops `undefined`. The typed version declares eleven of the
twelve optional, so the type checker knows it too.

**One shape per layout.** If fifty "kinds" of node are created by one literal, that is one interface, not
a union of fifty. Never write a union of two created shapes on a variable.

**Small integers** (`type int32 = import("bun").int32; type Flags = int32`) take four bytes. The compiler declares that type itself, whatever `bun-types` is installed; an alias of your own that is only called `int32` is a number. The build
proves that every value stored there is an int32 and stops where it cannot (`TS100031`). A cast needs the same proof: `resolveUpdatePriority() as Lane`
is that error if the call returns a `number` or an `any`. A typed version cannot add `| 0`, so a variable or a field that is stepped with
`++`, or that takes a sum, a length or a number from other code, is a `number`.

**A literal with no declared type is a trap.** `{ next: null }` gets a field that can only hold `null`.
Every literal with a `null`, `undefined` or constant member that is filled in later needs a declared type.

**A class field you add is `declare`d.** `class Stream { /*$*/declare buffer: SV.Given[]; declare alive: boolean;/*$*/` emits
nothing. Without `declare` the field is a definition and the property exists before the constructor stores to it.

**A constructor function declares `this` and is constructed without a cast.** In a compile build `new F(..)` has the type that `F`
declares for `this`, if the name `F` is a function declaration, or a variable that is initialized with the function expression and never
stored to, if no `return` of `F` has a value, and if the type is one interface, class or object type that the compiled code itself
declares. A cast of `F` is an assertion that nothing verifies: the compiler loses the callee there.

```ts
function RequestInstance(this: Request, state: State) { this.state = state; }
var request = new RequestInstance(state);
```

`tsc` and plain `bun check` give that `new` the type `any` and report TS7009: check a typed version with `bun check --aot`.
react-reconciler is written this way. react-dom's bundles still have `new (RequestInstance as FZ.RequestConstructor)(..)`.

**Return records as `any`.** A record type in the result of a function that a JavaScript file imports, or that a JavaScript entry exports
again, counts as data from outside: JavaScript may store anything to an object that it gets. The compiler then gives the type up in the whole
program: its objects are allocated as plain objects, and the typed code reads them by name too. seroval's `toJSON` and `toCrossJSON` said that they
return a `SerovalNode`, and in a TanStack Start server no node had a layout. Written as `any`, the same object merely escapes and keeps its
layout. `--explain=unknown-code` lists such a type as `reaches-unknown-code`.

**Say what is frozen.** Of `Object.freeze(x)`, `Object.seal(x)` or `Object.preventExtensions(x)` with an `x` of type `any` the compiler has to
assume that `x` may be any object with a layout in the whole program. Every layout then counts as one that may be frozen, and every store to a
field tests for it: 807 of the 3,520 stores in a TanStack Start server, react-dom's among them, for one line of seroval. Give the operand the
type of what really arrives.

**Do not lean on the host project.** The text is checked under its own options: the `compilerOptions` of its `sound.json`, or
`strict` alone. What the user's tsconfig asks of the user's own text (`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`,
`noImplicitOverride`, `verbatimModuleSyntax`, ..) is not asked of it. Two options are the exception, because they change what a
type means and a program has one set of types: `strictNullChecks` and `exactOptionalPropertyTypes` are the user's. Without
`strictNullChecks` a union cannot be told apart by `null`: so write the type on every variable. Under `exactOptionalPropertyTypes` a
property `x?: T` cannot be set to `undefined`: write `x?: T | undefined` where the code does that. Declare every global that
is newer than ES2020 or belongs to a host (`declare var Temporal: any;`), and reach for members the standard
library may lack through a marked cast.

**A file is typed at its own path.** The typed text replaces `cjs/x.production.js` at that path and keeps
its `exports.name = ..`. The entry, and how an importer finds `name`, stay npm's own, so `import { c } from "react/compiler-runtime"` is still
resolved when the program is built. The compiler accepts nothing else, and it is the faster form too: through an entry that re-exports the
`default` of a typed ES module, the importer has an object and looks `c` up by name at every call, some 25 instructions more. `PLACED` in
`check.py` lists the small files that are typed this way. Their sources are `.cts` files under `src/`, and
`check.py` writes them to `<out>/sound/<name>/`, not into `<out>/node_modules`, where a `.js` file would be read as JavaScript.

**So is a CommonJS bundle of which a program uses a part.** The compiler drops an export of a CommonJS module that nobody reads, and all that
only it reaches. An entry that re-exports the `default` of a typed ES module keeps every export alive. `react-dom/server` loads two bundles
and takes two functions of the legacy one: as ES modules the typed bundles were 221 KB (5%) more compiled code in a TanStack Start server
than they are at npm's own paths, and more than the untyped package. What opens a type from a dead export is dropped with the export:
`FormatContext` was open for `resumeRequest` alone. These packages have `form='placed'` in `check.py`: the typed text, followed by the shapes
of the ES form.

**Mind what your test tree does to the subject.** The compiler analyzes the entire program. One
`fromJSON(JSON.parse(text))` in seroval's tree opened the layout of every node, so the tree tested a
program with no closed layout at all. `trees/seroval/wide.ts` is therefore built as three programs: as
it is, `.internal` (the package only sees objects that it allocated) and `.boundary` (parsed JSON reaches the package only through an
untyped file). `run.py` says how.

### A variable that the bundle reuses

Minified bundles reuse variables: Closure-compiled code stores a fiber, then a number, then a queue in the same `var a`. The name cannot
change, so the variable is declared with the union of what it holds, and TypeScript's narrowing by assignment does most of the rest:

```ts
function f(a: RR.Fiber | RR.UpdateQueue) {
  a = (a as RR.Fiber).updateQueue;   // a parameter starts as its whole union: the first read needs a cast
  return a.shared;                   // narrowed by the assignment: nothing to write
```

Where the checker does not narrow (after a loop, a `switch`, a closure), write `!` or a cast to the type that the value has there. A cast
from a wider type costs a guard when the program runs. A false one is neither a `TypeError` nor a wrong answer: the code behind it
takes its slow version. So run the package's tests with `--aot-log-type-mismatches`. Also look for a read that is wider than it should
be without being an error: `update.next` is legal on `Update | FiberRoot`, and the compiler is then told a union of two layouts.
`(x satisfies Role)` finds those.

`one_name.py` does this by machine for a text that has a variable for each role (below). In react-reconciler 357 variables had 531 roles;
of 4,575 places where one is named, 1,439 got a cast and 283 a `!`.

```sh
BUN=path/to/bun python3 one_name.py path/to/node_modules react-reconciler/0.33.0 work/ [--write]
```

`BUN` has to be a Bun with `--aot`: the gates `strict` and `more` run `bun check --aot` on the text, so `node_modules` also has to hold
what the text requires (react and scheduler for react-reconciler, react and react-dom for react-dom).

An `int32` survives such a variable only if everything else that the variable holds is an object: `tag: RR.HookFlags | RR.Effect`. In a
union that also lists a `number` or an `any`, the value has lost its proof, and an `int32` that is not proven stops the build. In
react-reconciler `Flags`, `WorkTag`, `UpdateTag`, `RootExitStatus`, `PendingEffectsStatus`, `SuspenseContext`, `HookFlags` and
`SuspendedReason` are `int32`. `Lanes`, `Lane`, `RootTag` and `TypeOfMode`, which share reused variables with each other and with plain
numbers, are `number`.

A module without reused variables takes the short way through `one_name.py`. seroval's `src/typed.mts` goes to `lay/dist/index.js`
without its markers, with its declarations behind it as `declare namespace SV { .. }`. Then `tools/bang_index.py` writes `!` behind each
element read that is an error under `noUncheckedIndexedAccess` (38 in 29 lines). Five integer types become `number`: their values are
read back with a cast from a member that holds more (`node.s as SV.SymbolTag`, and `s` is `unknown`), and a cast to an `int32` needs a
proof.

```sh
BUN=path/to/bun python3 one_name.py path/to/node_modules seroval/1.6.9 work/ [--write]
```

### A package that the project patches

A typed version fits npm's code. A project that patches the package (`bun patch`, `patch-package`) keeps its own under `.sound/<name>/`,
and `tools/carry_patch.py` writes it: a line that the patch leaves alone keeps its types, a line that it adds or changes comes in as the
patch wrote it, and a parameter or variable that is left without a type there becomes `any`.

```sh
python3 tools/carry_patch.py npm/cjs/x.js <name>/<version>/lay/cjs/x.js node_modules/<name>/cjs/x.js .sound/<name>/lay/cjs/x.js
```

### Where a typed build spends its time

These read the code that was emitted, not what was planned. The two with `perf` need Linux.

```sh
BUN_JSC_aotMapFilePath=$PWD/app.map bun build --compile --aot app.tsx --outfile app
python3 tools/by_name_sites.py app.map /react-reconciler/        # which functions still reach properties by name
BUN_JSC_useAOTPerfMap=1 perf record -e instructions:u -c 500009 -o app.perf ./app
python3 tools/by_operation.py 500009 app.perf /tmp/perf-<pid>.map app.map   # instructions by IR operation: tests and guards, by name, by slot ..
python3 tools/stubs.py app.perf /tmp/perf-<pid>.map app.map                 # samples by stub
bash tools/this_programs.sh path/to/bun work/                               # builds and runs every test program that declares `this` on a function
```

### What the compiler no longer accepts

Every `src/` here relies on one of these. `check.py` still generates and checks them: that is what its gates
`splits`, `counts`, `form` and `entry` are for. Do not use them in a new typed version.

**A variable for each role.** Minified bundles reuse variables: Closure-compiled code stores a fiber, then a number, then a queue in the
same `var a`. These typed files give each role its own marked variable and write the suffix at every store and read of that role;
`verify` strips `$as[A-Z]\w*`, and the `splits` gate proves the split follows the data flow:

```ts
function f(a: RR.Fiber) { /*$*/var a$asQueue: RR.UpdateQueue;/*$*/
  a$asQueue = a.updateQueue;      // npm: a = a.updateQueue;
  return a$asQueue.shared;        // npm: return a.shared;
```

To the compiler that is one declaration more and another name, so the file is not npm's code.

**A variable with two roles opens the records it holds.** That is what the split was for, and it is still true. A variable without a
written type gets the union of everything that is stored to it. If one role is `any` (an error, a prop, a child) and another is a record, then `any` reaches the record, and the record and
all that it holds are open: every read of them gets a shape test and a slow path. Ten such variables left typed react-dom 10%
larger than the untyped package. `--explain=unknown-code` names such a variable for each record.

**Another module form.** `tools/module_form8.py` turns a CommonJS bundle into an ES module, and `tools/cjs_entry.py` keeps npm's own entry
text, resolves its `NODE_ENV` switch to the production arm and points `require('./cjs/x.js')` at `x.ts`. The entry stays CommonJS,
because an ES-module entry would turn `import { nameThatDoesNotExist }` from `undefined` into a build error and change what `require()`
returns. The manifest has a `when` for `NODE_ENV`, since the rewritten entry always loads the production bundle.

**A new file.** In format `1`, `"lay"` has `"new"` for a path that the installed package must not have. Such a file is never `x.ts` beside
`x.js` when there is an `x.d.ts`: the checker prefers `x.ts`, and the package's public types vanish for its users. It is
`x.sound.ts`.

## Carrying a typed version to another version

```sh
python3 carry.py react-dom/19.3.0/src/server.bun \
    old/node_modules/react-dom/cjs/react-dom-server.bun.production.js \
    new/node_modules/react-dom/cjs/react-dom-server.bun.production.js  out/
```

A line that is identical in both versions keeps its types; a changed line comes in bare. `carry.py` then prints
the three gates. From 19.3.0 to 19.2.8, 5,919 of 6,745 lines kept their types, leaving 142 type errors and 10
broken role splits (an unchanged line stores `x$asRole`, the bare line after it reads `x`; only `splits` sees that).
Fix `out/typed.cts` by hand, run `carry.py … --again` to read the gates again,
then run the tree against the new version.

Patch releases often differ only in their own version string. Those share one typed file: see `versions` and
`token` in `check.py`'s table. Only the newest has `lay/` in this tree; the others have `sound.json`, `lay.sums` and
`family.json`, and `publish.py` generates the rest and checks it against `lay.sums`.

## Publishing

```sh
python3 publish.py pack out/                        # every typed version; or name some: react-dom@19.3.1
# sound-react-dom-19.3.1.tgz    9 files   412345 B  5f0c...
npm publish out/sound-react-dom-19.3.1.tgz --access public
```

`pack` needs Python 3 and this folder, nothing else: no network, no `node_modules`, no compiler. It sends nothing. It writes no
tarball whose manifest, `package.json` and folder name disagree, whose `lay/` is not byte for byte what `lay.sums` pins, or
that names a path of the machine it was generated on. Run twice it writes the same bytes; `out/SUMS` lists them.

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

`pack.py` stops on a package without a `LICENSE` file or a copyright line. For a licence that is not in this table, read it first.

## Known differences from the untyped package

- seroval: none. `compileJSON()` of a tree that violates seroval's own declared types (a string where a node belongs, an id that is
  not a number) fails a guard at the first typed read of the wrong value. The slow version then does what npm's file does: it throws
  seroval's own error or emits what it can. Section 98 of `trees/seroval` has the cases, and `run.py answers` says at every run whether
  the section differs from `bun run`.
- React's typed files are its production files. In a build that does not define `process.env.NODE_ENV` as `"production"`, React's
  entries load their development files, which are compiled as installed.
