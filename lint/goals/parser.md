# Unit "parser": Bun's parse pass keeps TypeScript syntax for a lint parse

Read `/workspace/notes/lint/goals/COMMON.md` first. Its rules apply to everything below.

- Worktree: `/workspace/wt/parser`. Branch: `robobun/abbc0c92/lint-parser`.
- Notes directory (your log, `API.md`, `NEEDS.md`, final report): `/workspace/notes/lint/units/parser/`.
- You OWN: everything under `src/js_parser/`, the file `src/ast/ts.rs` (put the type nodes there, or in new
  files that `src/ast/ts.rs` declares as submodules with `#[path]`, so that `src/ast/lib.rs` does not change),
  `src/jsc/RuntimeTranspilerCache.rs` (only its `EXPECTED_VERSION`), and new test files that you create under
  `test/bundler/transpiler/` whose names start with `lint-parse` or `typescript-grammar`.
- You do NOT own: `src/ast/lib.rs`, `src/runtime/`, `src/typecheck/`, `src/lint/`, `Cargo.toml`, `Cargo.lock`.

## Background you must read

- `/workspace/notes/lint/parser-inventory/` if it exists: every place where the parser consumes
  TypeScript-only syntax, what is dropped, the node that would own it, the matching node of typescript-go, and
  the hard cases. If it does not exist, the list "Hard cases" below is the summary, and you derive the sites
  from the code: 37 call sites of `skip_*` functions in 8 files, 30 inline drops that call no skip function,
  18 returns of the `S::TypeScript` placeholder, 7 dropped module paths of type-only imports and exports.
- The code as it is now: `src/js_parser/parse/type_sink.rs` (the sink trait, `Discard`, `DecoratorMetadata`),
  `src/js_parser/parse/parse_skip_typescript.rs` (the type grammar), `src/js_parser/parse/parse_entry.rs`
  (`Parser::parse_only` is the existing parse-without-visit entry, JavaScript only, with
  `StartsForParseOnly` in `src/js_parser/p.rs` as its boxed side table).
- The reference parser: `/workspace/ref/typescript-go/internal/parser/parser.go` and `internal/ast`.

## Hard cases (verified facts about the parser today)

- H1. Arrow-function parameters are parsed as expressions (`parse_paren_expr`), `: T` is skipped on the spot,
  and only after `)` the expressions are converted to bindings. The annotation has no owner when it is read.
- H2. `as`, `satisfies`, non-null `!`, `<T>x`, instantiation expressions and parentheses leave no node. The
  handlers return the bare operand, and the parse pass pattern-matches on the bare operand (`typeof x`,
  `delete`, labels, expression-to-binding conversion).
- H3. Speculation restores the LEXER only (`lexer_backtracker_bool`, `lexer_backtracker_result`). Anything
  that fills a side table or logs through `self.log()` during a failed attempt is not undone. Inside
  speculation a missing type is accepted silently, because `lexer.unexpected()` cannot fail when the log is
  disabled. Two errors already leak out of backtracked attempts (`The modifier "out" is not valid here`).
- H4. `(` at the start of a type: the code first tries arrow arguments with a reduced binding grammar, then
  falls back to a parenthesized type. The reduced grammar rejects valid input (`(a = 1) => void`).
- H5. Arrow return type between `?` and `:`: the parser parses the return type AND the arrow body, throws both
  away, restores a full `ParserSnapshot` and parses again.
- H6. Tuple labels are recognised AFTER a type was consumed, with special arms for keyword labels.
- H7. Object types: one loop handles interfaces, type literals, mapped types and import attributes. It
  swallows any run of names, so modifiers, `get` / `set`, `new` and the property name are indistinguishable.
- H8. `implements` and interface `extends` entries are skipped as arbitrary types. Class `extends` parses an
  expression and then skips type arguments.
- H9. Type-only statements return a zero-size placeholder that `parse_stmts_up_to` drops. Other code reads
  the placeholder to mean "this was only a type".
- H10. Declared and overloaded declarations are parsed and discarded together with their scopes. The visit
  pass requires the scopes it meets to equal `scopes_in_order`, same order and kind.
- H11. Type parameters are consumed before the scope of their owner exists, and they declare nothing.
- H12. Class member modifiers restart the member parser without a record. Abstract and declare members,
  overloads and index signatures return `Ok(None)`.
- H13. Parameter properties: the modifier is first parsed as a binding, then the binding is parsed again.
- H14. `type` on import and export specifiers is recognised after the name was turned into a name ref.
  Type-only import statements parse and discard their path and create no import record.
- H15. Contextual keywords: `type as = 1` and `interface as {}` fail today.
- H16. Positions: the lexer has no end of the previous token, `expect_greater_than` splits `>>` without a call
  to `next()`, some nodes are created before their own last token is consumed, and prefixes (`export`,
  `declare`, decorators) are outside the `Loc` of the node.
- H17. Decorator metadata is computed by the grammar while parsing, with symbol lookups at `Loc::EMPTY`.
- H18. The string name or wildcard pattern of an ambient module is never read.

## Milestones, in this order. Commit and push after each step inside a milestone.

### P1. The type grammar reads what tsc reads

The type grammar and the other TypeScript-only productions differ from tsc today. Measured on probes: of 625 type
forms, Bun accepts 117 that tsc rejects and rejects 68 that tsc parses. Verified examples: Bun accepts
`let x: (a: ) => void`, `let f = (a): => a`, `f<A | >(x)`. Bun rejects `const v = <out>x`,
`let g: (a = 1) => void`, `type as = 1`. The conditional-type arm has no binding-level test, so the operands of
`|`, `&`, `keyof` and `readonly` swallow `extends B ? C : D`: `A | B extends C ? D : E` must be
Conditional(Union(A, B), ...), as in the reference.

1. Make every VALID TypeScript construct parse, in every mode. Build the list yourself by probing: write probe
   inputs per production, run them through the installed `bun` and through tsc
   (`node_modules/typescript`, version 6.0.2, `ts.createSourceFile(...).parseDiagnostics`), and fix each
   input that tsc parses without a diagnostic and Bun rejects. Keep the probe script and its inputs in your
   notes directory.
2. Give the grammar the tree shape of the reference: precedence of `|`, `&`, type operators, conditional
   types, function and constructor types, tuple labels, object type members. The associated constant
   `TypeSink::CONDITIONAL_FALSE_LEVEL` exists only because the two modes parse the type after `:` at
   different levels. Remove that difference and the constant.
3. `emitDecoratorMetadata` output changes where the old shape gave the wrong tag. For each changed case, the new
   `design:type` / `design:paramtypes` / `design:returntype` must equal what tsc 6.0.2 emits
   (`experimentalDecorators` + `emitDecoratorMetadata`). Show the table (input, old, new, tsc) in your report.
4. DO NOT make a parse WITHOUT lint reject input that it accepts today. Users run such files. Input that tsc
   rejects and Bun accepts keeps running. The strict grammar, with tsc's diagnostics, applies only to a lint
   parse (milestone P3). Say in `API.md` how the grammar knows which one it is (the sink is the natural place).
5. Bump `EXPECTED_VERSION` in `src/jsc/RuntimeTranspilerCache.rs` by one, because output changes.
6. Tests: `test/bundler/transpiler/typescript-grammar.test.ts`. One `test.each` table per group. Each case fails
   with the installed release `bun` (`USE_SYSTEM_BUN=1 bun test <file>`) and passes with your build.
   The existing files must still pass: `test/bundler/transpiler/decorator-metadata.test.ts`,
   `test/bundler/bundler_decorator_metadata.test.ts`, `test/bundler/transpiler/transpiler.test.js`,
   `test/bundler/esbuild/ts.test.ts`, `test/bundler/transpiler/decorators.test.ts`,
   `test/js/bun/typescript/type-export.test.ts`, `test/bundler/transpiler/transpiler-stack-overflow.test.ts`,
   `test/cli/run/transpiler-cache.test.ts`. Where an existing expectation encodes the old wrong tag, change
   the expectation and name it in your report with the tsc output as proof.
7. Regression guard for runs without lint: write a differential harness (generate snippets from the
   productions of the grammar, valid and with one token changed, each as a declaration, as the type of a
   decorated field, as a parameter type and as a return type; transform each with `Bun.Transpiler` in several
   configurations, with and without `emitDecoratorMetadata`; compare the output and the error lists of the
   base build and of your build). Every record that differs must be one of your intended changes. List the
   count of differing records by cause. Keep the harness in your notes directory.

### P2. Type nodes and the `Build` sink

1. Define the type nodes in `bun_ast::ts` (module `src/ast/ts.rs`): one node kind for each type node kind of the
   reference (`internal/ast`: keyword types, literal types, type reference with type arguments, qualified
   names, array, tuple with named, optional, rest and variadic members, union, intersection, conditional with
   `infer`, mapped with modifiers and `as` clause, indexed access, type operator `keyof` / `unique` /
   `readonly`, type query with type arguments, function and constructor types with type parameters and
   parameters, type literal with property, method, call, construct, index, get and set signatures, template
   literal type, import type with attributes, parenthesized type, type predicate and `asserts`, `this` type).
   Plus type parameters (constraint, default, `in` / `out` / `const`), parameters of signatures (modifiers,
   name or binding pattern, `?`, type, initializer), and heritage clauses (expression with type arguments).
   Every node has a start AND an end offset. Nodes live in the arena of the lint parse, never in the `Expr` or
   `Stmt` stores. Keep node structs small and say `size_of` of each in `API.md`.
2. Add `Build: TypeSink`. Extend the trait where `Build` needs more than the two other sinks (children, positions,
   lists): add methods with default empty bodies or associated types so that `Discard` and `DecoratorMetadata`
   compile to what they are now. Proof required in your report: the symbol sizes of the `Discard` instantiation
   of the grammar functions before and after, and the instruction counts of the benchmark, on release builds of
   the base and of your branch (helpers: see COMMON.md). The five groups must show +0 conditional branches and
   an instruction delta that you explain line by line if it is not 0.
3. Token ends: the lexer has no "end of the previous token". Do NOT add a store to `Lexer::next`. The `Build`
   sink reads `lexer.range()` / `lexer.end` at the points where it finishes a node, inside lint-only code.
   Type argument and type parameter lists that end in a split `>>`, `>=`, `>>=` need care: test them.

### P3. The lint parse entry and the sidecar

1. `Parser::parse_for_lint`: a cold entry beside `parse_only` that accepts JavaScript, TypeScript, JSX and TSX
   and `.d.ts` / `.d.mts` / `.d.cts` (ambient context), skips the transpiler cache and the `// @bun` shortcut,
   runs the parse pass with the `Build` sink and the strict grammar, and does NOT run the visit pass. The
   statement list, `scopes_in_order` and the value symbols must be the same as in a normal parse of the same
   file: prove it with a test that visits and prints a lint-parsed tree and compares the bytes with the normal
   transpile, over every `.ts` and `.tsx` file under `test/` and `src/js` that parses.
2. The sidecar extends the boxed side table that `parse_only` already has (`starts_for_parse_only`,
   `Option<Box<..>>` on `P`): `P` must not grow (const assertions in `src/js_parser/p.rs`: 3,808 bytes in a
   release build, 3,888 with debug assertions). The sites test the option AFTER the token test that already
   guards them, inside the `IS_TYPESCRIPT_ENABLED` blocks, and call `#[cold]` helpers.
3. What the sidecar records, each with start and end offsets, keyed so that a later pass can attach it to the
   node it belongs to (say how in `API.md`, per kind; a `Loc` alone is NOT a unique key: `a.b.c` gives three
   nodes with the same `Loc`, and header structs are copied by value into their parents):
   - the type annotation of every variable, parameter, property, accessor, catch binding, and every return
     type, type predicate and `this` parameter;
   - type parameters and type arguments (calls, `new`, tagged templates, JSX, instantiation expressions,
     heritage clauses);
   - postfix and prefix wrappers that leave no node today: `as`, `as const`, `satisfies`, non-null `!`, `<T>x`,
     and parentheses (the checker needs to know that an expression was parenthesized). Postfix records are made
     at the call sites where the operand is in scope and hold the operand `Expr` by value plus the operator
     offset;
   - the statements that are dropped: interfaces, type aliases, every `declare` form (var, let, const,
     function, class, enum, namespace, module with string or wildcard name, `global`), overload signatures of
     functions, methods and constructors, abstract members, index signatures in classes, `export as namespace`,
     type-only imports and exports with their module paths;
   - modifiers that are dropped: accessibility, `readonly`, `abstract`, `override`, `declare`, `accessor`,
     definite `!`, optional `?`, `const` on enums, `type` on import and export specifiers, parameter
     properties;
   - every comment with its range and kind, including comments inside JSX opening tags
     (`next_inside_jsx_element` does not pass the comment hook today) and comments before the first token;
   - triple-slash directives and the `@ts-nocheck` / `@ts-check` pragmas of the file header.
   Erased statements stay OUT of the statement list. They are recorded in the sidecar, keyed by their position
   between the statements that stay.
4. Speculation: every sidecar list must be rewound by saved length at each backtracking point
   (`lexer_backtracker_bool`, `lexer_backtracker_result`, the full `ParserSnapshot`). Unit tests force each
   backtracker and compare the record counts before and after.
5. Syntax errors of a lint parse carry tsc's diagnostic code where the reference has one for the same
   condition (`TS1005`, `TS1109`, `TS1110`, ...). The parser stops at its first error as today: error recovery
   is out of scope, say so in `API.md`.
6. Write `/workspace/notes/lint/units/parser/API.md`: the public types and functions that other units call
   (`parse_for_lint`, the result type, the sidecar tables, the type nodes), with signatures. Other units read
   ONLY that file to learn your interface, so keep it current with every commit and save the notes.

## Out of scope for this unit

The CLI flag, lint rules, the node index, binder and checker, the conformance corpus, JSDoc parsing (keep the
comment text and range, a later unit parses JSDoc), error recovery.
