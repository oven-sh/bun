# What the typecheck unit needs in files it does not own

## Lowering (`src/typecheck/lowering/`, commit `9684ef6a7d`)

### L1. The lint parse in this worktree (`src/js_parser`, `src/ast`, owner: parser)

For: type syntax in the node table. `Parser::parse_only` is `P<'a, false, false>`: a JavaScript parse. A file with a
type annotation does not parse, and a TypeScript file without one is read as JavaScript (`a < b > (c)` is two
operators). The lowering needs, from the parser's branch (`robobun/abbc0c92/lint-parser`), merged here:

- the entry that `API.md` of the parser names, `Parser::parse_for_lint(self, f: impl FnOnce(&ParsedForLint<'_, 'a>) -> R)`,
  with the statements as written, as `ParsedOnly::stmts` gives them today;
- `bun_ast::ts` (`Type`, `Member`, `List<T>`, `Token`, `Name`, ...) and, for every place where the tree drops
  TypeScript syntax, the entry of the side table that holds it, reachable from the `Stmt`, `Expr`, `Binding`,
  `G::Fn`, `G::Arg`, `G::Class`, `G::Property` or `G::Decl` that the lowering is at: type annotations, type
  parameters, type arguments of a call, of `new` and of a tagged template, `as`, `satisfies`, `!`, `<T>expr`,
  `implements`, modifiers, index signatures, overloads, `declare`, `abstract`, `enum`, `namespace`, `interface`,
  `type`, `import =`, `export =`, `export as namespace`, the `?` of a parameter or a member, `accessor`.

The lowering reads positions from its own scanner, so `start` and `end` of a type node are only needed to find the
node, and `full_start` is not needed.

When L1 lands: `lowering/type_arguments.rs` goes (Bun's TypeScript parse then says where type arguments are), and
each `Unsupported` for a TypeScript declaration becomes the lowering of its nodes.

### L2. A lint parse rejects what typescript-go rejects (`src/js_parser`, owner: parser)

`Parser::parse_only` accepts these and typescript-go reports a parse error with another tree. The lowering refuses
each of them today (`LowerErrorKind::OutOfStep`), which gives an internal diagnostic where tsc prints a syntax error:
`a + b = c`, `-a = b`, `a++ = b`, `await x = y`, `a++ ++`, `a--.b`, `++ delete a.b`, `new A?.b()`, `yield*` without an
operand. Not refused, with Bun's tree: `a.` before a line `b in c` (TS1003), `for (using of of [])` (TS1011).
If the lint parse reports them with the codes of the reference, the checks in the lowering stay as assertions.

### L3. A caller outside the crate (`src/runtime/cli/lint_command.rs`, owner: cli)

`bun_typecheck::lowering::{lower_source_file, LowerOptions, Lowered, LowerError, LowerErrorKind, ParseDiagnostic}`
are `pub` and nothing outside the crate calls them: the `unused_pub` ratchet counts them until the command does.
The call is the sequence of `lowering/tests.rs` (`lower`): `Parser::parse_only`, inside its closure
`FileBuilder::new(text)`, `lower_source_file(&mut builder, text, parsed.stmts, options)`, `FileBuilder::finish`.
