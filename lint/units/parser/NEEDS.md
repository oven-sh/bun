# What the parser unit needs in files it does not own

## N1. A diagnostic code on `bun_ast::Msg` (`src/ast/lib.rs`, owner: cli)

For: P3.5, syntax errors of a lint parse carry the code of tsc.

`bun_ast::Msg` in the worktree of the parser has no field for a code, and `bun_ast::Metadata` has the two variants
`Build` and `Resolve`. The parser needs the interface that the cli unit describes in its `API.md`
("Diagnostic code on `bun_ast::Msg`"), with these exact signatures:

```rust
pub enum Metadata {
    Build,
    Resolve(MetadataResolve),
    /// The number of a TypeScript diagnostic: `Code(1005)` is TS1005.
    Code(u32),
}

impl Msg {
    /// `Some(number)` for `Metadata::Code(number)`, `None` for `Build` and `Resolve`.
    pub fn code(&self) -> Option<u32>;
}

impl Log {
    /// Pushes one `Kind::Err` message with `Metadata::Code(code)` and adds 1 to `errors`.
    pub fn add_range_error_with_code(
        &mut self,
        source: Option<&Source>,
        r: Range,
        code: u32,
        text: Cow<'static, [u8]>,
        notes: Box<[Data]>,
    );
}
```

One more method would let the parser keep the message of Bun and add the code to it after the fact, which is what
its sites do today (the lexer logs, the site that knows the condition names the code):

```rust
impl Msg {
    /// Makes the message carry `code`. A message of a resolve error keeps its metadata.
    pub fn set_code(&mut self, code: u32);
}
```

### Workaround on our side, in place now

`bun_js_parser::parse::syntax_errors` keeps the codes in a table of the parser:

- `Parser::parse_for_lint_with_codes(self, errors: &mut SyntaxErrors, f)` fills `errors` when the parse fails.
- `SyntaxErrors::get(msg: usize) -> Option<&SyntaxError>` gives, for the message at index `msg` of `Log::msgs`, the
  code, the range and the text of the reference (`SyntaxError { msg, code, start, end, text }`).
- The text of the message in the log stays the one of Bun. A caller that prints as tsc prints takes `code` and
  `text` of the entry, and the message of the log where no entry exists.

The full description is in `API.md`, "Syntax errors of a lint parse: the codes of the reference".

### What changes in the parser when N1 lands

- `P::code_syntax_error` and the reading of `Expected a but found b` at the end of the parse
  (`syntax_errors::of_lexer_message`) go: `Lexer::expected_string`, the lexer sites of TS1002, TS1160 and TS1010 and
  the sites that call `P::unexpected_as`, `P::type_expected` and `P::function_or_constructor_type_to_error` pass the
  code when they log. The log then carries the code through every place that drops and restores messages, and the
  records that follow the address of the text of a message go too.
- `Parser::parse_for_lint_with_codes`, `SyntaxErrors` and `SyntaxError` go. `Parser::parse_for_lint` keeps its
  signature. A caller reads `msg.code()`.
- Open for the owner of `Msg`: whether the text of a coded message is the text of Bun (`Expected ";" but found "x"`)
  or the text of the reference (`';' expected.`). The table has both today.
- A parse without lint logs the same messages either way. If the lexer passes the code in every parse, no test of
  "is this a lint parse" is needed in it, and `Msg::write_format` must go on printing no code, as the cli unit says
  it does.

## N2. No caller of the new public items in another crate (`mordant` ratchet `unused_pub`)

`Parser::parse_for_lint_with_codes`, `SyntaxErrors::{entries, get}` and `SyntaxError` are `pub` and have no caller
outside `bun_js_parser` until the cli unit calls them. The ratchet counts them for
`src/js_parser/parse/syntax_errors.rs` and `src/js_parser/parse/parse_entry.rs`, as it counts
`Parser::parse_for_lint`. Needed from the cli unit: the call, in `src/runtime/cli/lint_command.rs`:

```rust
let mut errors = bun_js_parser::parse::syntax_errors::SyntaxErrors::default();
match parser.parse_for_lint_with_codes(&mut errors, |parsed| /* index, bind, check */) {
    Ok(result) => result,
    Err(_) => {
        for (index, msg) in log.msgs.iter().enumerate() {
            match errors.get(index) {
                // `error TS1005: ';' expected.` at `entry.start..entry.end`
                Some(entry) => { /* entry.code, entry.text */ }
                None => { /* the message of Bun */ }
            }
        }
    }
}
```

## N3. No JavaScript reaches a lint parse in this worktree (`src/runtime`, owner: cli)

For: the test files `test/bundler/transpiler/lint-parse*.test.ts` that parser.md allows, and every check of P2 and
P3 that is to run with `bun bd test`.

Everything that JavaScript or a command line can call is in `src/runtime`, and nothing there calls
`Parser::parse_for_lint` in this worktree. `Bun.Transpiler` and the one parser hook of `bun:internal-for-testing`
(`bytecodeOrderNames`, which ends in `Parser::parse_only`) run a parse without lint. So no test that `bun bd test`
runs can reach the `Build` sink, `Parser::parse_for_lint`, the side table or a backtracking point of a lint parse,
and no file `lint-parse*.test.ts` exists.

The route is the command of the cli unit, `bun --lint` (`src/runtime/cli/lint_command.rs`): once it holds the call
of N2, a test spawns `bun --lint <file>` and reads what it prints. What the command calls on our side, exactly:

```rust
impl<'a> Parser<'a> {
    pub fn parse_for_lint_with_codes<R>(
        self,
        errors: &mut SyntaxErrors,
        f: impl FnOnce(&ParsedForLint<'_, 'a>) -> R,
    ) -> Result<R, Error>;
}
```

No binding of `bun:internal-for-testing` is asked for. One that printed the side table would need a printer of
every table in `src/runtime`, or a `pub` one in the parser that only that binding calls.

### Workaround on our side, in place now

The tests of P2 and P3 are `#[test]`s inside `bun_js_parser`, which see what is `pub(crate)`, and they run in
this worktree with `cargo test -p bun_js_parser --lib`. The test binary links because
`src/js_parser/native_test_shims.rs` defines, in Rust and under `#[cfg(test)]`, the C and C++ symbols that it
links to. `API.md`, "How the tests of the parser run", has the commands of each milestone and what the stand-ins do.

## N4. No job of CI runs the tests of `bun_js_parser` (`.github/workflows/rust-lints.yml`, no unit owns it)

For the integrator. CI runs the `#[test]`s of a crate only in the job `cargo miri test`, for the crates of
`MIRI_CRATES` in `scripts/rust-miri.ts`. `bun_js_parser` cannot join that list: a parse calls
`bun_core::StackCheck::is_safe_to_recurse`, which reads the stack pointer with inline assembly (`frame_address` in
`src/bun_core/util.rs`), and Miri runs no inline assembly. The job `cargo clippy` type-checks the tests
(`cargo check --workspace --all-targets`) and runs none.

Needed: one step in the job `clippy`, after the step `cargo check --all-targets`:

```yaml
      - name: cargo test -p bun_js_parser
        env:
          BUN_CODEGEN_DIR: ${{ github.workspace }}/build/debug/codegen
        run: cargo test -p bun_js_parser --lib
```

The setup of that job builds the targets `codegen`, `clone-lolhtml` and `clone-rust-argon2` and installs clang and
lld, which is what the step needs: the test binary links no object of C or C++. The step was not run in CI.

### Workaround on our side, in place now

The same command in the worktree, after one `bun bd --version`.
