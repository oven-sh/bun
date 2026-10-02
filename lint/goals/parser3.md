# Unit "parser", round 3: a parse without lint goes back to main's type skipper

Read `/workspace/notes/lint/goals/COMMON.md` first, then `/workspace/notes/lint/goals/parser.md` (round 1: what you
own) and this file. This file REPLACES `parser2.md`: its part A is done by the integrator, with the result below.

- Worktree: `/workspace/wt/parser` (it is the main checkout of the machine, the only tree with warm build
  directories). Branch: `robobun/abbc0c92/lint-parser`. Push it after every commit:
  `git push origin HEAD:robobun/abbc0c92/lint-parser`.
- Notes: `/workspace/notes/lint/units/parser/`. Save them with `/workspace/tools/save-notes "parser: <what>"`.

## What was measured (2026-10-01, linux-x64 release builds, the benchmark of this pull request)

Base: main at `f4d755a9cf`. Head: the pull request branch merged with that main (`23a20afa7e`), which holds round 1.
`/workspace/notes/lint/tools/cgbench.sh`, 20 passes, counts for the symbols of `bun_js_parser`:

| Group | Instructions | Conditional branches |
|---|---:|---:|
| bun-types (declaration files) | +10.7% | +12.2% |
| typescript-lib (declaration files) | +14.6% | +16.1% |
| src-js | +0.43% | +0.79% |
| tsx | +3.9% | +6.0% |
| js-control (JavaScript only) | -0.07% | +0.065% (+203,340) |

Parser text: 1,400,688 to 1,670,251 bytes (+269,563). `P<true,false>` 475,578 to 611,843. `P<true,true>`, the
scan-only parser, 191,090 to 318,030. Stripped binary: 80,873,032 to 81,249,864 bytes (+376,832).

Where it goes, for typescript-lib: main's `skip_type_script_type_with_opts::<false>` (89.6 M instructions),
`skip_type_script_object_type` (32.7 M) and `skip_type_script_type_arguments` (11.9 M) are gone. In their place:
`parse_type::<Discard>` 57.9 M, `parse_type_operator_or_higher::<Discard>` 40.8 M,
`parse_property_or_method_signature` 36.3 M, `parse_type_member` 33.1 M, `parse_postfix_type_rest::<Discard>`
25.7 M, `parse_type_reference::<Discard>` 21.0 M, `parse_stmt_named_like_cast` 14.2 M,
`skip_type_script_type_arguments_in::<Discard,false,false>` 12.5 M, and `Lexer::next` +25.0 M.

So the grammar that reads what tsc reads costs about twice the skipper in the type grammar, for every TypeScript
file that Bun runs or bundles. That breaks the first rule of this work: a parse without `--lint` pays nothing.

## The decision

Two grammars, one for each job.

1. A parse WITHOUT lint uses main's skipper, with main's behaviour, byte for byte: what it accepts, what it
   rejects, every error text, every `emitDecoratorMetadata` value. The form to restore is the one of commit
   `6b7ade0f2a` ("js_parser: make the type grammar generic over a sink"): main's control flow with the sinks
   `Discard` and `DecoratorMetadata`. That form was measured against main: +0 instructions and +0 branches in
   all five groups, and the same 816 instructions in the `Discard` instantiation. Keep the one later fix that
   belongs to it: `Metadata::MDot` is a `StoreSlice<Ref>` in the arena, and `TypeSink::member` takes the arena
   (commit `be1ebe5295`).
2. A LINT parse (`Parser::parse_for_lint`) uses the grammar of round 1, which reads what tsc reads and builds
   type nodes. It is its own set of functions, in its own files, used with the `Build` sink only. It can drop
   the parts that only existed to serve `Discard` and `DecoratorMetadata`.
3. Every site outside the type grammar that round 1 changed gets the same treatment: without lint it runs main's
   code. The only thing a parse without lint may pay is ONE test of the side-table option at a site that
   TypeScript-only syntax reaches, after the token test that already guards the site. JavaScript pays nothing.

## What is required, in this order

R1. The restructuring above. Commit in steps that build.
R2. Proof of behaviour: a parse without lint equals main. Run your differential harness
    (`/workspace/notes/lint/units/parser/grammar-diff/`: `harness.mjs`, `diff.mjs`, the corpora) with the base
    binary `/workspace/base/bun.f4d755a9c` (a release build of main at `f4d755a9cf`, already made; if the file is
    gone, build main again) and a release build of your branch (`/workspace/tools/lk bun run build:release -j10`
    in the worktree, about 40 minutes). Required: ZERO differing records. Not one newly accepted input, not one
    newly rejected input, not one changed output.
    Then set `EXPECTED_VERSION` in `src/jsc/RuntimeTranspilerCache.rs` back to 33 and remove the line about
    version 34: the output of the transpiler does not change.
R3. Proof of cost, on the same two binaries (`/workspace/base/bun-profile.f4d755a9c` and your
    `build/release/bun-profile`): `python3 /workspace/notes/lint/tools/symsizes.py <bun-profile>` and
    `/workspace/notes/lint/tools/cgbench.sh <bun-profile> <out dir> <tag> 20`. Required:
    - js-control: +0 instructions and +0 conditional branches. Find the +203,340 branches of today
      (`parse_arrow_body_with_flags` replaced `parse_arrow_body`, and others) and remove the cause.
    - The four TypeScript groups: every added conditional branch is one executed test of the side-table option.
      Count the executions (a debug counter in a scratch build, or `cgsum.py --top 60` on both sides) and report
      them per KB of source. Expected order of size: 1 to 3 per KB. Instructions follow from that.
    - The `Discard` and `DecoratorMetadata` instantiations of the skipper have main's size. Report the parser
      text, the four `P<..>` rows and the stripped binary, base and head.
R4. The tests of round 1 that assert a change of a parse without lint
    (`test/bundler/transpiler/typescript-grammar*.test.ts`, 366 cases: newly accepted syntax, decorator metadata
    equal to tsc) no longer hold. Do not delete their knowledge:
    - Every case becomes a test of the LINT grammar (a Rust test of the crate with the tsc oracle, as the tests
      of the `Build` sink are), and later a `bun --lint` test.
    - Write the list of valid TypeScript that main's skipper rejects, and of decorator metadata values that
      differ from tsc, into `API.md` ("Known differences of a parse without lint"). They are defects of main that
      this pull request does not fix. Do not fix them here.
    - The nine older test files of parser.md P1.6 pass unchanged, as on main.
R5. Then the open items of round 2, part B (`parser2.md`, B1 to B5): comments, directive comments, triple-slash
    directives and pragmas in the side table; the tsc code on the `Msg` (`bun_ast::Metadata::Code`); the lint
    parse rejects what typescript-go rejects; the list "Not done" of `API.md`.

## Always

- `cargo test -p bun_js_parser --lib` stays green (70 tests at the start of this round).
- The public interface of the lint parse does not change shape without a note in `API.md`: the cli unit and the
  typecheck unit read `ParsedForLint`, the side table and the type nodes.
- RUN WHAT YOU WRITE, through `/workspace/tools/lk`, one heavy command at a time, timeout 3600000 ms.
