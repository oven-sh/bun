# full-types

Full types of npm packages, for `bun build --compile --aot`.

```
node_modules/react/                                what npm installed; never touched
  compiler-runtime.js
  cjs/react-compiler-runtime.production.js

.full-types/react/                                 the full types
  full-types.json                                  what they fit, what they replace
  lay/cjs/react-compiler-runtime.production.js     the same code with TypeScript types added: replaces the
                                                   installed file, in memory, for this build
```

```sh
bun build --compile --aot --define 'process.env.NODE_ENV="production"' app.tsx
# note: "react" 19.3.1 is compiled from its full types in .full-types/react
```

The ahead-of-time compiler gives objects a fixed layout, and where it knows which objects reach
`fiber.flags`, that read is a load at an offset. In a package that ships plain JavaScript it knows only
what it can prove by following each object from the place that creates it. Where the proof fails, the
property is looked up by name. With a declared type, a guard checks a value once, where it reaches the type, and the
code behind the guard relies on the type.

Full types are **the package's own published file with type annotations added and nothing else
changed**. Erase the types and you get npm's code back: a gate proves that on every run, and the compiler
proves it again in every build. The compiler doesn't accept all the full types in this folder yet: see
[What the compiler accepts](#what-the-compiler-accepts).

## Using them

One of these; the first that is there wins.

1. **In the project:** copy `<name>/<version>/full-types.json` and `<name>/<version>/lay/` to
   `<project root>/.full-types/<name>/`.
2. **In the package itself:** nothing to do. A package can ship its own full types: `index.full.ts` beside
   `index.js`, named by the `"full-types"` condition of its `exports`. It has no `full-types.json`.
3. **As a package of its own:** `node_modules/@oven/full-types-<name>/`, with the same `full-types.json` and `lay/`. For `@scope/name`
   that is `@oven/full-types-scope__name`. This is what `publish.py` packs. Bun looks in the `node_modules` of the project root,
   then in that of each folder above it.

Bun looks nowhere else.

Nothing on disk is modified. During an `--aot` build Bun reads each file under `lay/` instead of the installed
file at the same path. Without `--aot`, `bun run`, `bun test` and `bun build` never see them.

What `full-types.json` pins is **all or nothing**. If anything does not fit, the build stops with an error naming the
first mismatch. A program never gets slower without you hearing about it:

```
error: TS100056: The full types of "react-dom" in .full-types/react-dom can't be used: they are for version 19.3.1, but 19.2.8 is installed. Replace them with the full types for 19.2.8, or remove them
```

The code is compared file by file. A full-types file that is not the installed file with types added gets the same
error. What a package ships for itself (2 above) is not yours to repair: there the same sentence is a warning, and the
installed file is compiled.

### When the error comes

What to do, by what the error says:

| the error says | do this |
|---|---|
| they are for version X, but Y is installed | replace them with the full types for Y. The versions that exist are the folders here. If there is none for Y: pin the package to X, or remove the full types |
| they need process.env.NODE_ENV to be defined as "production" | pass `--define 'process.env.NODE_ENV="production"'`, to `bun check --aot` as to the build. In other builds the package's entry loads its development files, which are not typed |
| this version of Bun doesn't support the "format" in full-types.json | `"format"` is not `2`. Format `1` is no longer read: see [What the compiler accepts](#what-the-compiler-accepts). A higher number is newer than your Bun: update Bun |
| they add F, and full types can only replace installed files | `"lay"` says `"new"` for F. Add the types to the installed file, at its own path |
| lay/F is missing | `"lay"` lists F, and there is no such file under `lay/`. Copy the whole `lay/` folder |
| they need the full types of "P", which are not used | `"needs"` lists P. Copy P's full types to `.full-types/P/` too. If it is there, the build has an error about it as well |
| lay/F without its types doesn't match F | the full-types file changes code: a name, a literal, an operator, one statement more or less. Only types may be added. Or something changed `node_modules/<name>/F`: `patch-package`, `bun patch`, a postinstall script. Full types fits npm's code only: see [A package that the project patches](#a-package-that-the-project-patches) |
| in lay/F, TypeScript syntax that emits code can't be erased | the full-types file has an `enum`, a `namespace` that is not `declare`d, a parameter property, a decorator, an `accessor` field, JSX, `import x = require()` or `export =` |

A package for which no full types are installed is compiled as always, and nothing is said.

## full-types.json

```json
{
  "format": 2,
  "name": "react",
  "version": "19.3.1",
  "when":  {},
  "lay":   { "cjs/react-compiler-runtime.production.js": "f7d518f5…" },
  "needs": []
}
```

| field | meaning |
|---|---|
| `format` | format number: `2`. A file under `lay/` holds TypeScript text under the name of the installed `.js`, `.cjs` or `.mjs` file. It replaces that file at its own path, so nothing about how modules find each other changes, and it is read as TypeScript. Any other number stops the build |
| `name`, `version` | must equal the installed package.json's, exactly |
| `when` | build-time defines that must have these string values: `{ "process.env.NODE_ENV": "production" }` |
| `lay` | path inside the package to the sha256 of the installed file it replaces. The replacement is `lay/<same path>`. The compiler doesn't compare the sum: it compares the code, node for node. The gates of this folder compare it |
| `needs` | names of other packages whose full types must also be in use |
| `compilerOptions` | optional: the options that the files under `lay/` are type checked under, as in a tsconfig.json. Without it: `strict`, with the default `lib` and with `@types/bun` where it is installed, as for the full types that a package ships |

Paths are relative, use `/`, and may not contain `..`. `package.json` cannot be replaced.

The manifests in this folder also have `"basis": {}`. The compiler doesn't read that member. `pack.py`, `publish.py` and
`test/bundler/compile-aot-full-types.test.ts` still ask for it.

## What the compiler accepts

The compiler relies on no gate of this folder. In every build it parses each full-types file that the program loads, parses the installed
file, and compares the two trees node for node with the types erased (`src/sema/erasure.rs`). White space and comments do not
count. So what is compiled is the code that `bun run` would load.

| | |
|---|---|
| erased | annotations, type parameters and type arguments, `as`, `satisfies`, `!`, `this:` parameters, interfaces, type aliases, type-only imports and exports, overload signatures, and whatever is `declare`d, class fields included |
| not erased | TypeScript syntax that emits code: an `enum`, a `namespace` that is not `declare`d, a parameter property, a decorator, an `accessor` field, JSX, `import x = require()`, `export =`. In a CommonJS file also an `export` of a type, which would make it an ES module |
| has to be the same | everything else: each statement, name, literal and operator, in the same order |

Full types that changes more than types stops the build with the error above, until it is written again: at npm's own paths, with
nothing but types added. The full types in this folder keep to the rule: react, react-reconciler, @anthropic-ai/sdk, react-dom,
seroval.

## What is in this folder

```
<name>/<version>/
  package.json  full-types.json  lay/          what gets published
  LICENSE  NOTICE                              published too: the package's own licence; whose code it is and what was changed
  lay.sums                                     sha256 of every file under lay/
  family.json                                  instead of lay/: this version is another one with its version string changed
pack.py       writes a <name>/<version>/ folder from the .full-types/ of a project and the packages as npm installed them
publish.py    writes the tarballs to publish, from this folder alone
trees/installs/<set>/package.json              the versions that the full types are for, to install them as npm does
```

Each file under `lay/` is the installed file, edited in place. `pack.py` pins the sums, and every build proves that the files are the installed
code and that they type check.

| test | what it asks |
|---|---|
| `test/bundler/compile-aot-full-types.test.ts` | every manifest, licence file and pinned sum in this folder |
| `test/aot/full-types-prove-every-int32.test.ts` | the large bundles type check in a build, and every `int32` in them is proven |
| `test/aot/typed-react-costs-no-more-than-erased.test.ts`, `test/aot/int32-lanes-of-react-reconciler-cost-less-than-numbers.test.ts` | the types of react-reconciler pay |
| `AOT_SERVERS=koa-typed,express-typed,fastify-typed bun test test/aot/servers` | the servers give the same answers with the full types |
| `cargo test -p bun_sema_parser --test analysis_erasure typed_packages`, after `bun install` in each `trees/installs/<set>` | each file under `lay/` is the installed file with types added |
| `test/aot/servers/measure`, `test/aot/typed-packages/measure` | what the full types buy, in instructions and bytes |

## Making full types of a package

Pick the file that actually runs (the production bundle, not the sources: that is what users have).

```sh
mkdir -p .full-types/koa/lay/lib && cp node_modules/koa/lib/request.js .full-types/koa/lay/lib/
cp .full-types/koa/lay/lib/request.js work/request.ts                        # the build names only the first error: check a copy by itself
bun check --aot --all --no-pretty work/request.ts
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
changes.

**Allocated here or passed in.** An interface means a fixed layout. That is right for objects that the file itself
allocates and wrong for anything that other code can pass in: options bags, user values, callbacks, props, data out of
`JSON.parse`. Type those `any` through a named alias (`type Options = any`), in a section of their own.
A plain object that reaches an interface type doesn't have the layout. Nothing is converted or copied and nothing throws: the guard
at that place fails, and the function goes on in its slow version. The type is then no longer proven where such a value can get to:
every read through it there tests the shape first and has a slow path.

**The type must say what really arrives.** A value of another type than the one you wrote throws nothing and changes no answer. The
guard that it meets fails, and the function goes on in its slow version, which does what npm's file does. So a wrong type costs what the
full types were written to win, and no test of the package notices: `--aot-log-type-mismatches` logs each one. A member that is
missing is no mismatch: it reads as `undefined`, and `undefined` and `null` pass every type. seroval's nodes are allocated with twelve
members, but a node that went through JSON has two to six, because JSON drops `undefined`. The full types declares eleven of the
twelve optional, so the type checker knows it too.

**One shape per layout.** If fifty "kinds" of node are created by one literal, that is one interface, not
a union of fifty. Never write a union of two created shapes on a variable.

**Small integers** (`type int32 = import("bun").int32; type Flags = int32`) take four bytes. The compiler declares that type itself, whatever `bun-types` is installed; an alias of your own that is only called `int32` is a number. The build
proves that every value stored there is an int32 and stops where it cannot (`TS100031`). A cast needs the same proof: `resolveUpdatePriority() as Lane`
is that error if the call returns a `number` or an `any`. Full types cannot add `| 0`, so a variable or a field that is stepped with
`++`, or that takes a sum, a length or a number from other code, is a `number`.

**A literal with no declared type is a trap.** `{ next: null }` gets a field that can only hold `null`.
Every literal with a `null`, `undefined` or constant member that is filled in later needs a declared type.

**A class field you add is `declare`d.** `class Stream { declare buffer: SV.Given[]; declare alive: boolean;` emits
nothing. Without `declare` the field is a definition and the property exists before the constructor stores to it.

**A constructor function declares `this` and is constructed without a cast.** In a compile build `new F(..)` has the type that `F`
declares for `this`, if the name `F` is a function declaration, or a variable that is initialized with the function expression and never
stored to, if no `return` of `F` has a value, and if the type is one interface, class or object type that the compiled code itself
declares. A cast of `F` is an assertion that nothing verifies: the compiler loses the callee there.

```ts
function RequestInstance(this: Request, state: State) { this.state = state; }
var request = new RequestInstance(state);
```

`tsc` and plain `bun check` give that `new` the type `any` and report TS7009: check full types with `bun check --aot`.
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

**Do not lean on the host project.** The text is checked under its own options: the `compilerOptions` of its `full-types.json`, or
`strict` alone. What the user's tsconfig asks of the user's own text (`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`,
`noImplicitOverride`, `verbatimModuleSyntax`, ..) is not asked of it. Two options are the exception, because they change what a
type means and a program has one set of types: `strictNullChecks` and `exactOptionalPropertyTypes` are the user's. Without
`strictNullChecks` a union cannot be told apart by `null`: so write the type on every variable. Under `exactOptionalPropertyTypes` a
property `x?: T` cannot be set to `undefined`: write `x?: T | undefined` where the code does that. Declare every global that
is newer than ES2020 or belongs to a host (`declare var Temporal: any;`), and reach for members the standard
library may lack through a cast.

**A file is typed at its own path.** The typed text replaces `cjs/x.production.js` at that path and keeps
its `exports.name = ..`. The entry, and how an importer finds `name`, stay npm's own, so `import { c } from "react/compiler-runtime"` is still
resolved when the program is built. The compiler accepts nothing else, and it is the faster form too: through an entry that re-exports the
`default` of a typed ES module, the importer has an object and looks `c` up by name at every call, some 25 instructions more.

**So is a CommonJS bundle of which a program uses a part.** The compiler drops an export of a CommonJS module that nobody reads, and all that
only it reaches. An entry that re-exports the `default` of a typed ES module keeps every export alive. `react-dom/server` loads two bundles
and takes two functions of the legacy one: as ES modules the typed bundles were 221 KB (5%) more compiled code in a TanStack Start server
than they are at npm's own paths, and more than the untyped package. What opens a type from a dead export is dropped with the export:
`FormatContext` was open for `resumeRequest` alone.

**Mind what your test tree does to the subject.** The compiler analyzes the entire program. One
`fromJSON(JSON.parse(text))` in seroval's tree opened the layout of every node, so the tree tested a
program with no closed layout at all.

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

An `int32` survives such a variable only if everything else that the variable holds is an object: `tag: RR.HookFlags | RR.Effect`. In a
union that also lists a `number` or an `any`, the value has lost its proof, and an `int32` that is not proven stops the build. In
react-reconciler `Flags`, `WorkTag`, `UpdateTag`, `RootExitStatus`, `PendingEffectsStatus`, `SuspenseContext`, `HookFlags` and
`SuspendedReason` are `int32`. `Lanes`, `Lane`, `RootTag` and `TypeOfMode`, which share reused variables with each other and with plain
numbers, are `number`.

### A package that the project patches

Full types fits npm's code. A project that patches the package (`bun patch`, `patch-package`) keeps its own under `.full-types/<name>/`:
the patched file with the types added.

## Publishing

```sh
python3 publish.py pack out/                        # all full types; or name some: react-dom@19.3.1
# oven-full-types-react-dom-19.3.1.tgz    9 files   412345 B  5f0c...
npm publish out/oven-full-types-react-dom-19.3.1.tgz --access public
```

`pack` needs Python 3 and this folder, nothing else: no network, no `node_modules`, no compiler. It sends nothing. It writes no
tarball whose manifest, `package.json` and folder name disagree, whose `lay/` is not byte for byte what `lay.sums` pins, or
that names a path of the machine it was generated on. Run twice it writes the same bytes; `out/SUMS` lists them.

Patch releases often differ only in their own version string. Those share one full-types file. Only the newest has `lay/` in this tree; the
others have `full-types.json`, `lay.sums` and `family.json`, and `publish.py` generates the rest and checks it against `lay.sums`.

`test/bundler/compile-aot-full-types.test.ts` checks every manifest, licence file and pinned sum in this folder on each CI run.

## Licences

Full types are a copy of the package's code, so it is published under the package's licence, with the package's `LICENSE`
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
  seroval's own error or emits what it can.
- React's full-types files are its production files. In a build that does not define `process.env.NODE_ENV` as `"production"`, React's
  entries load their development files, which are compiled as installed.
