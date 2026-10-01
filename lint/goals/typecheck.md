# Unit "typecheck": the node table, the binder and the checker, ported from typescript-go

Read `/workspace/notes/lint/goals/COMMON.md` first. Its rules apply to everything below.

- Worktree: `/workspace/wt/typecheck`. Branch: `robobun/abbc0c92/lint-typecheck`.
- Notes directory (your log, `API.md`, `NEEDS.md`, `PORT_STATUS.md`, final report):
  `/workspace/notes/lint/units/typecheck/`.
- You OWN: everything under `src/typecheck/` (crate `bun_typecheck`, it exists as an empty crate) and everything
  under `test/cli/lint/typecheck/` (new). You may edit `src/typecheck/Cargo.toml`, then run `cargo check` to
  refresh `Cargo.lock` and commit the lock with it.
- You do NOT own: `src/js_parser/`, `src/ast/`, `src/runtime/`, `src/lint/`, `test/cli/lint/conformance*`,
  the root `Cargo.toml`.

## Background you must read

- `src/react_compiler/DESIGN.md`: how a mechanical port onto `bun_ast` is laid out and kept in sync.
- The reference: `/workspace/ref/typescript-go/internal/{ast,binder,checker,core,diagnostics,evaluator,jsnum,
  scanner}`. Sizes: checker 60,301 lines (checker.go 32,296, relater.go 5,044, flow.go 2,764, inference.go
  1,684, jsx.go 1,488, grammarchecks.go 2,185, types.go 1,474), binder 3,544.
- Measured facts (from a source build of the reference that ran its 12,797 test instances with coverage):
  the checker and binder are 51,890 lines of function bodies, and they are tightly coupled. A test instance
  is reachable when every function it enters is ported. With the 10,005 lines that almost every instance
  enters, 74 instances are reachable. With 28,713 lines, 1,293. With 41,334 lines, 5,819. So the conformance
  pass rate stays near zero for most of the port and rises late. Do not be discouraged by that, and do not
  reorder the port to chase early passes. 157 functions (3,350 lines) are entered by at least 99.5% of the
  instances: checker initialisation, symbol merging, the binder's declaration and flow functions.
- Diagnostics of the reference: 2,130 messages of TypeScript plus 86 extras minus 10 collisions = 2,206
  (Error 1,379, Message 807, Suggestion 20). Ten extras replace TypeScript's text under the same code
  (1549, 5074, 5090, 5112, 6048, 6353, 6401, 6420, 8030, 9019). A message is compared by pointer in checker
  control flow at 24 places, so a message needs a stable id. Types in messages are printed by building
  synthetic type nodes and running the emit printer (`checker/printer.go`, `nodebuilder*`).
- Concurrency of the reference: a pool of checkers (default 4), each file belongs to one checker, the tree and
  the bound symbols are shared read-only, and types, signatures, links and caches are per checker. Use ONE
  checker for now, but keep the node table and the bound symbols immutable after binding and `Sync`.

## The one architectural decision of this unit

The checker does not read `bun_ast` directly. It reads a NODE TABLE shaped like the reference's AST: every node has
an id (dense `u32`), a kind (the reference's `Kind`), flags, a parent, `pos` and `end`, and typed accessors for
its children and properties with the same names as in `internal/ast` (`name`, `type_node`, `initializer`,
`parameters`, `type_parameters`, `members`, `modifiers`, `expression`, `arguments`, ...). Reasons: the reference
reads `Parent` at thousands of places and keys its side tables by node id, and a port that keeps upstream's
function bodies line for line needs upstream's tree shape.

Two producers fill the table:
1. A LOWERING from Bun's lint parse (tree as written plus sidecar). It depends on the parser unit. Read
   `/workspace/notes/lint/units/parser/API.md` when it exists. Until then, write the lowering for what
   `bun_ast` has today (JavaScript statements, expressions and bindings) behind the same builder interface.
2. A TEST IMPORTER that loads a tree dumped as JSON by TypeScript itself. Write the dump script in
   `test/cli/lint/typecheck/` with `typescript` 6.0.2 from the repository's `node_modules`
   (`ts.createSourceFile`, walk with `forEachChild`, emit kind, pos, end, flags, modifiers and the property name
   of each child). This producer lets you test the binder and the checker against upstream's baselines NOW,
   before Bun's parser keeps types, and it isolates a checker bug from a parser or lowering bug for ever.
   Where TypeScript 6.0.2's tree differs from typescript-go's (JSDoc, reparsed nodes, some flags), convert in the
   importer and list each difference in `API.md`.

## Milestones, in this order. Commit and push after each step. Keep `PORT_STATUS.md` current and saved.

`PORT_STATUS.md` has one row per upstream file and function group: upstream path and line range, Rust module,
state (not started, ported, tested), and the upstream commit (89d5d5b). It is the map for whoever continues,
and after a restart of the machine it is the only record of where the port stands besides the code.

### K1. Foundations
- `UPSTREAM_PORTED` (repository and commit), crate layout with upstream's file names as module names
  (`checker/checker.rs` may be split along upstream's own section comments, keep the order of functions).
- The node table, its builder, and the test importer. Port the parts of `internal/ast` that the binder and
  checker call: kinds, node flags, modifier flags, symbol and symbol flags, the utilities in `utilities.go`,
  `core` helpers, `jsnum`, the scanner's text helpers that the checker calls. Port `internal/evaluator`.
- Diagnostics: generate the message table from
  `/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json` merged with
  typescript-go's extra messages (extras win by code). Check in the generated Rust file together with the
  script that made it and a test that fails when the two disagree, unless the repository's own code
  generators (`src/codegen/`) offer a build step that you can follow exactly. Port the formatting, the message
  chain and the related-information structures.
- Tests for K1: through `cargo test -p bun_typecheck` if the repository runs cargo tests for other crates
  (look for `#[cfg(test)]` in `src/` and for how CI runs them), else through a `bun:test` file that calls a
  small internal entry. Say which one you chose and why in `API.md`.

### K2. The binder
Port `internal/binder` completely: declarations with the three meanings (value, type, namespace), merging,
containers and locals, flow nodes, strict-mode checks, the JavaScript-specific binding. Its own symbol tables:
it never writes a `bun_ast` symbol. Test: for every file of a vendored subset in
`test/cli/lint/typecheck/fixtures/` (choose about 200 conformance cases across directories, copy them from
`/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases` with their `.symbols` baselines), the
binder's symbols match upstream. If the `.symbols` baseline needs the checker to print, compare what can be
compared now (declaration names, flags, parents) and say what waits.

### K3. The checker, layer by layer, in upstream's dependency order
Order: data model (`types.go`, `links.go`, `mapper.go`), utilities, type keys and object types, the resolution
stack, checker initialisation and globals, symbol merging, name resolution, aliases and modules, literal,
union and intersection construction, tuples, declared types, type nodes to types, constraints, base types,
members, lookup, apparent types, signatures, instantiation, types of symbols, widening, the type printer,
relations (`relater.go`), elaboration, expressions, literals, operators, property access, type facts,
functions, return inference, calls and overloads, inference, contextual typing, control flow narrowing
(`flow.go`), reachability, keyof, indexed access, substitution, conditional, mapped and template literal
types, iteration and async, JSX, decorators, declaration checks for classes, interfaces, enums, modules,
unused and unreachable diagnostics, grammar checks (`grammarchecks.go`).
Rules of the port:
- Ids instead of pointers: `TypeId`, `SymbolId`, `SignatureId`, `NodeId`, all `u32`, in arenas owned by one
  checker. Upstream's pointer-keyed maps become id-keyed maps. Keep upstream's iteration orders where an order
  can reach output (union ordering, `CompareTypes`, sorting by id).
- Lazy resolution with re-entrancy (`pushTypeResolution`, the circularity stack), mutation of a type after
  creation (deferred members, resolved base types) and the depth limits (`instantiationDepth`, relation
  depth) are ported as they are, with the same limits and the same comparison operators.
- A function that is ported is ported whole. A callee that is not ported yet is a stand-in that records its
  name in a "stand-in log" and returns the error type. A test instance that reaches a stand-in is
  "provisional" and never counts as passing. Remove each stand-in when its layer lands.
- Every upstream `panic` and assert becomes an internal diagnostic plus a safe fallback.

### K4. First visible result
`const x: number = "s";` checked through the node table gives exactly
`min.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` with the lib files loaded from
`/workspace/ref/typescript-go/_submodules/TypeScript/src/lib` (the program layer that embeds them is a later
unit: take a directory path as input for now).

### K5. Conformance ratchet
When `/workspace/notes/lint/units/conformance/API.md` exists, plug the checker into its runner through the
test importer, and record the list of passing instance names. The list may only grow.

## Out of scope for this unit

The parser and sidecar, the CLI, lint rules, tsconfig parsing and module resolution from disk (take already
resolved inputs), lib embedding, declaration emit, the language service parts of the reference
(`services.go`, hover, completions).
