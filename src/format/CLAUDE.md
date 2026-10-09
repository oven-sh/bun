# `bun format`

A formatter for JavaScript, JSX, TypeScript, JSON, CSS, Less, SCSS, GraphQL, YAML, Markdown and MDX whose output is byte for byte that of Prettier. The target is the released **3.9.9**: its source, its snapshots, and the npm package as an oracle.

- **The specification is Prettier**: `src/language-js/**`, `src/document/**`, `src/main/comments/**`, and its snapshot tests, `tests/format/{js,jsx,typescript}/**/__snapshots__/format.test.js.snap`.
- **The code is a port of oxc's formatter** (`crates/oxc_formatter_core`, `crates/oxc_formatter`), which is a port of Biome's, which is modelled on Prettier. Where oxc deviates from Prettier, Prettier wins. Both are MIT licensed. See the crate docs in `lib.rs`.
- **There is no AST of its own**. It prints straight from the type checker's HIR through the handles of `bun_lint::ast` (`src/lint/CLAUDE.md` has the table ESTree → handles).

Not there: Svelte, Astro, Babel-only proposals, plugins. CSS, GraphQL, Markdown and HTML in templates are formatted: `css/embed.rs`, `graphql/embed.rs`, `markdown/embed.rs`, `html/in_js.rs`.

**Flow.** A file is Flow if `--parser flow` or `babel-flow` says so, if a comment before its code has `@flow` or `@noflow`, or if it is called `.js.flow` (`bun_lint::linter::goes_to_flow`). The caller picks the dialect: `Dialect::flow_parser` for Prettier's `flow`, `Dialect::flow` for `babel-flow`, for which `flow::uncommented` first makes code of `/*:: */` and `/*: */`. The HIR has no node of its own for Flow: `src/sema/parser/parser/flow.rs` has the table of what stands for what, `src/lint/ast/flow.rs` tells the nodes apart, `js/print/flow.rs` has all that is printed differently. The functions for the nodes of TypeScript call it behind `f.file().is_flow()`, after the dispatch on the kind of node: a file that is not Flow pays one load where a hook is. Tests: `--languages=flow`.

## The pipeline

```
File (HIR + binder tables)                     bun_lint::ast
  └─ js::comments::collect   → [Comment]       all comments, in order, with what is around them
  └─ js::format_file         → [FormatElement] the document (IR): ir/element.rs
       └─ ir::document::Tracker                told about each element as it is written: a group with a forced line
                                               break in it is broken, every other group is measured
  └─ ir::printer::print    → bytes           decides which groups fit on the line
```

`ir/run.rs` has the entry point, `format(file, &options, &mut scratch, &mut out)`. `Scratch` holds every buffer, so that formatting the next file allocates nothing.

What a caller does with a file, in this order, is `format_text` in `src/lint/standalone/format_cmd.rs`: JSON, style sheets, GraphQL, YAML and Markdown by `options.parser` or the name of the file (`json::format`, `css::format`, `graphql::format`, `yaml::format`, `markdown::format`: they take text), `pragma::before_parsing`, parse as a module and, if that fails, as a script, `sort_imports::sorted_text`, `range::format_with_cursor` (which is `format` if there is no range and no cursor).

**Import sorting** (`js/sort_imports/`, option `FormatOptions::sort_imports`, compiled once per run from `sort_imports::Settings`) has four flavours. `@trivago`/`@ianvs` `importOrder*` and prettier-plugin-organize-imports are text → text preprocessors in Prettier, so they are here too: `sort_imports::sorted_text(file, how)` gives the text that has to be parsed and formatted instead of the file, byte for byte the plugin's (`babel.rs`: @babel/parser's comment attachment over the HIR, `generator.rs`: @babel/generator's printer for imports, `trivago.rs`/`ianvs.rs`: the plugins, `organize.rs`: TypeScript's organizeImports and textChanges), or `None` if formatting the file as it is gives the same (`layout.rs`): only a file whose imports move is parsed twice. oxfmt's `sortImports` (`oxfmt/`) happens inside `format`: `FormatStatements` tells an `ImportRun` what it is about to write, a run of imports is captured and written as `Interned` sub-ranges, one per line, in sorted order. Tests: `bun-lint format sort-imports cases|bench|serve`, oracles in `test/cli/format/oracle/sort-imports/`.

| directory                                     | what                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | oxc                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ir/`                                         | the IR, `Formatter`, builders (`group`, `indent`, `soft_line_break`, ..), macros, the printer. Knows nothing about JavaScript except `Formatter::context`                                                                                                                                                                                                                                                                                                                                                                                                                                               | `oxc_formatter_core`                           |
| `options.rs`                                  | `FormatOptions`, with oxc's field and type names, and `set("semi", "false")` with Prettier's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `oxc_formatter/src/options.rs`                 |
| `js/format.rs`                                | `impl Format for Expr, Stmt, TypeNode, ..`: comments, `prettier-ignore`, parentheses, then dispatch to `js/print/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | the generated `ast_nodes/generated/format.rs`  |
| `js/ast_nodes.rs`, `fields.rs`, `siblings.rs` | the tree as oxc sees it: `AstNodes`, `parent()`, `span()`, field accessors, the next sibling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ast_nodes/`                                   |
| `js/comments.rs`, `trivia.rs`                 | which comments are printed where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `formatter/comments.rs`, `formatter/trivia.rs` |
| `js/parentheses/`                             | `needs_parentheses`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `parentheses/`                                 |
| `js/print/`                                   | one function per kind of node                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `print/`                                       |
| `js/utils/`                                   | what several kinds of nodes share: assignments, member chains, conditionals, strings, numbers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `utils/`                                       |
| `js/sort_imports/`                            | import sorting: `@trivago`/`@ianvs` `importOrder*`, oxfmt's `sortImports`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                |
| `json/`, `css/`, `graphql/`                   | JSON (`json`, `json5`, `jsonc`, `json-stringify`), style sheets (`css`, `less`, `scss`) and GraphQL, each with a parser of its own. `embed.rs` in the last two: the same in the templates of JavaScript                                                                                                                                                                                                                                                                                                                                                                                                 |                                                |
| `yaml/`                                       | YAML: ports of `yaml` (lexer, CST, composer with its errors), of `yaml-unist-parser` and of `language-yaml`. Prints with `css/doc.rs`. Also the front matter of style sheets and of Markdown                                                                                                                                                                                                                                                                                                                                                                                                            |                                                |
| `markdown/`                                   | Markdown and MDX: `parse.rs` makes the tree of micromark and remark (for MDX: of remark-parse 8) from the events of Bun's own parser, `bun_md`. `printer.rs` is `language-markdown`. Prints with `css/doc.rs`. Code blocks go to the other formatters. For JavaScript the caller passes a closure to `markdown::format_with`, or sets `FormatOptions::format_javascript`, since this crate does not parse it                                                                                                                                                                                            |                                                |
| `handlebars/`                                 | Handlebars as Glimmer reads it (`.hbs`, `.handlebars`): ports of the lexer and the grammar of `@handlebars/parser`, of `simple-html-tokenizer` and of the handlers of `@glimmer/syntax` in the mode `codemod`, and `language-handlebars`, which writes to the `Elements` of `css/doc.rs`. What the parsers drop or change (a doctype, `{{this/a}}`), Prettier does not print, and neither does this: but `Scratch::is_damaged()` says so afterwards, and the caller leaves the file as it is. Whoever finds another kind of damage sets the flag where it happens and adds an input to `format.test.ts` |                                                |
| `html/`                                       | HTML, Vue, Angular templates, LWC and MJML: ports of `angular-html-parser`, of `language-html` and of the lexer and parser of Angular's expressions. It writes to the document of `ir/`. See "HTML" below                                                                                                                                                                                                                                                                                                                                                                                               |                                                |
| `toml/`                                       | TOML, only in the flavor of oxfmt (Prettier has none): the tokens of Bun's own scanner (`bun_parsers::toml::TOML::tokens`), the tree that taplo's parser makes of them, and a port of the formatter of `oxc-toml` as far as oxfmt's options reach. Keys and values are copied. What Bun does not read as TOML is a syntax error: oxfmt writes such a file again around its errors, and out of order                                                                                                                                                                                                     |                                                |
| `js/jsdoc/`                                   | oxfmt's option `jsdoc`: JSDoc comments are formatted as prettier-plugin-jsdoc does. Off unless `.oxfmtrc.json` sets it. A comment whose formatted text would have `*/` in it stays as it is. What is a tag, a type, a name and a text in a comment is read by `file.jsdoc()` (`src/lint/ast/jsdoc.rs`), nothing here splits a comment. The parameters that `@param` tags are sorted by are those of the function in the tree                                                                                                                                                                            | `formatter/jsdoc/`                             |
| `conformance/`                                | the crate `bun_format_conformance`: runs the tests of Prettier and of oxfmt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |                                                |
| `pragma.rs`, `range.rs`, `cursor.rs`          | `insertPragma`/`requirePragma`/`checkIgnorePragma`, `rangeStart`/`rangeEnd`, `cursorOffset`: Prettier's `src/main/core.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |                                                |
| `verify.rs`, `verify/`                        | a check that formatting did not change the program: the trees and the comments before and after                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `detect_code_removal` (different)              |

## Style sheets, YAML, Markdown: the other printer

These three are ports of Prettier's own printers, which count on what `printDocToString` does step by step (two line breaks in a row are an empty line, `dedentToRoot`, how a `fill` measures), so they do not print with `ir/`. `css/doc.rs` has `Elements`, the parts of a document one after the other in one list, and `printDocToString`, `fits` and `fill` on it. `Doc` is the tree, for who takes documents apart (Markdown, embedded code). `doc::print` writes it to `Elements`. There is one printer.

The printer for style sheets returns no documents. It writes operations (text, lines, start and end of a group, indentation, items of a `fill`) to `css/sink.rs`. **There is one implementation of every rule, and two ways to take what it writes.** At first the sink writes straight to the output: outside of groups a line is a line break, inside everything is on one line. That is what Prettier prints if the line fits as a whole. If it does not, or a group has something in it that is more than its content on one line (a forced break, a line suffix), `Sink::end_unit` says so, what has been written of the statement is taken back, and the printer writes the statement again, to `Elements`. So writing a statement must have no effect but what it writes.

`css/memo.rs` keeps, per thread and up to 1 MB, what a declaration was printed as on one line, and writes that again for the same declaration. Half of the declarations of a style sheet are repeats. A mistake here makes the output of a file depend on the files that the thread has formatted before, which no fixture shows. Therefore:

- **The key has to hold everything that the printed line depends on**: the text of the declaration, all of it (`Printer::memo_text`), and `Printer::memo_context`: the syntax, `singleQuote`, `trailingComma`, the flavor, the name of the at-rule around it, and whether it is in an ICSS rule, a Less variable, a nested property of SCSS. **Whoever makes the printing of a declaration look at one more thing (an option, an ancestor, a sibling, text outside of it) adds that to the key, or keeps such declarations out of the memo.** The width is not in the key: a hit is measured at the end of its line like everything else.
- Nothing is kept of a declaration with a comment, a line break or a block, of one that failed, or of a style sheet that is written as a document. The style sheets of a file of HTML have a memo of their own, for that file.
- After any change to how declarations are printed: `test/cli/format/oracle/fuzz/css-memo-orders.py` (all style sheets on one thread in three shuffled orders and once without the memo) and `css-memo-surroundings.py` (the same declarations in many surroundings). The first has found a key that was too short.

## HTML

```
text ─ lexer.rs ─→ tokens ─ parser.rs, parse.rs ─→ Tree (ast.rs) ─ preprocess.rs ─→ what white space counts ─ printer.rs, tag.rs ─→ the document of ir/
```

- **It prints with `ir/`**, because scripts and expressions are written to the same document by `js/`, and HTML in a template of JavaScript is part of that file's document. `writer.rs` has Prettier's builders. The printer of `ir/` writes no line break on an empty line, Prettier's does, so the `Writer` keeps track of whether the line is empty and asks for an empty line where Prettier gets one from two line breaks in a row. **Everything goes through the `Writer`**, or through `Writer::foreign` for what another formatter writes.
- **Scripts and expressions** (`js.rs`, `embed.rs`, `vue.rs`): this crate cannot parse JavaScript, so the caller does: `FormatOptions::parse_javascript`, or the closure that `html::format_with` is given, which keeps its interner. `Formatter::write_embedded` lends the document to a formatter for the other text. An expression is the file `(` expression `)` whose name starts with a NUL. Its `ast_parent()` is `AstNodes::Program`, which stands for Prettier's `JsExpressionRoot` and `NGRoot`. `f.options().in_html` says what Prettier's `__` options and its parsers for expressions say. A hook in `js/` is a named function next to its use. A name, a path of names and their negation are written without being parsed (`write_path`).
- **Imports and JSDoc comments in scripts**: `html::options_of_host` says which of `sort_imports` and `jsdoc` is for the code in a text, by its parser: oxfmt's are for a Vue file only, the plugins of Prettier sort everywhere. `js.rs::with_file` applies them to `Piece::Script`, never to an expression. In a Vue file the plugins work on the text before it is parsed: `with_sorted_scripts`. `test/cli/format/sort-imports/hosts.json` has what the tools print.
- **The flavor of oxfmt**: oxfmt hands HTML, Vue, Angular and MJML to the Prettier that it brings along, so all of it is `Flavor::Prettier` (`options_of_host`), style sheets and expressions too. Its plugin takes over the parsers `babel`, `babel-ts` and `typescript`, in a Vue file only: `Options::script_flavor`. There a script is parsed one way, `Syntax::Ts`, or `Syntax::Tsx` if a script of the file says `lang="tsx"`, and a native `on*` attribute is a script like another, which Prettier hugs.
- **Angular** (`angular.rs`, `angular/`): a port of Angular's own lexer and parser says what is an error, and rewrites the expression as TypeScript that our parser reads into the same tree: `a | b: c` is `a | b(c)`, and in Angular every `|` is a pipe.
- **Other languages**: YAML, Markdown, JSON, GraphQL, Handlebars and the style sheets of a file of HTML are printed to text at the width that is left (`Writer::printed_text`). Where that width is not known (in a template of JavaScript, in Markdown), and for a `style` attribute, a style sheet comes as a `Doc` (`css::document`) that `css/embed.rs::write_document` writes to the document. Prettier calls `cleanDoc` with the document of what is embedded: `Sink::is_cleaned`.
- `in_js.rs`, `map_strings.rs`: HTML in the templates of JavaScript, Prettier's `embed/html.js`.
- `verify.rs`: the check before a file is written. The same elements, attributes, comments and blocks in each other the same way, and the same letters as often in all that is text, in whatever language. `test/cli/format/oracle/fuzz/html/content-mutants.ts` damages formatted files and counts what it notices.
- `cursor.rs`: `cursorOffset`. A range is all of the text in Vue and nothing elsewhere, as in Prettier.
- Fuzzers and guards: `test/cli/format/oracle/fuzz/html/`.

## oxc file → our file

Same name unless listed. `print/mod.rs` of oxc (1900 lines) is split:

| oxc `print/mod.rs`                                                                                                 | here                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| identifiers, `this`, objects, properties, unary, update, `await`, `yield`, chain, assignment targets, `<T>e`, `e!` | `print/expressions.rs`, and the one-liners in `format.rs::write_expression`                                |
| statements: `if`, loops, `break`, labels, `with`, expression statements                                            | `print/statements.rs`                                                                                      |
| binding patterns, `array_pattern.rs`, `binding_property_list.rs`, `assignment_pattern_property_list.rs`            | `print/patterns.rs`, `print/object_pattern_like.rs`, `print/expressions.rs`                                |
| literals                                                                                                           | `print/literals.rs`                                                                                        |
| enums, interfaces, modules, `import =`, `export =`                                                                 | `print/ts_declarations.rs`                                                                                 |
| keyword types, references, literals, signatures, predicates, `typeof`, `import()` types                            | `print/ts_types.rs`, and the one-liners in `format.rs::write_type`                                         |
| `template/mod.rs`                                                                                                  | `print/template.rs` (`template/embed/`: `css/embed.rs`, `graphql/embed.rs`, after Prettier's `embed/*.js`) |
| `oxc_syntax` operators and precedence                                                                              | `utils/operators.rs`                                                                                       |
| `oxc_formatter_core` `buffer.rs`, `arguments.rs`, `state.rs`, `format_extensions.rs`                               | `ir/formatter.rs`                                                                                          |

## How the code differs from oxc's

### The IR

`FormatElement` is 16 bytes and `Copy`. There is no arena and there are no lifetimes in it: text is a range of the source (`SourceText`), a range of `Storage::text` (`OwnedText`), or up to 14 bytes inline (`Token`). Interned content is a range of `Storage::pool`.

There is no pass over a finished document. `Formatter::write_element` tells `document::Tracker` about every element, and when a group or captured content ends, what the printer has to know about it is written into its start tag or its `Skip`: whether something in it forces a line break (Prettier's `propagateBreaks`), and `Flat`: how wide it is on one line. So **every element has to go through `f.write_element` or a builder**, never `f.storage.pool.push`, and `f.elements_from(start).will_break()`, `memoized.inspect(f).will_break()` cost nothing. A document that is written without a `Formatter` (JSON) calls `document::propagate_expand` once, which replays it to a `Tracker`.

The printer decides on a measured group from its width and a look at what follows it up to the next possible line break, and prints a group that fits with `print_flat`, a loop that only writes texts. A group is not measured if what it is on one line depends on the printer: content that depends on another group by id, a line suffix, a variant with a forced line break. Those are measured element by element, as in Prettier.

Three frequent shapes are one element each, which the builders write by themselves: `if_group_breaks(&",")` (`TokenIfBreaks`), the `indent` + line break of `soft_block_indent`, `block_indent`, .. (`StartIndentWithLine`, `EndIndentWithLine`), and `group(&indent(&soft_line_break_or_space())).with_group_id(id)` (`IndentedLineGroup`).

### `Formatter` is concrete

No `dyn Buffer`, no generic context. `f: &mut Formatter<'a>`, where `'a` is the lifetime of the file.

| oxc                                                                  | here                                                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write!(f, [a, b])`, `write!(f, a)`                                  | the same. **Import the macros by name**: `use crate::{write, format_args, best_fitting};` next to `use crate::prelude::*;`                                      |
| `impl Format<'a, JsFormatContext<'a>> for X`                         | `impl<'a> Format<'a> for X`                                                                                                                                     |
| `&mut JsFormatter<'_, 'a>`                                           | `&mut Formatter<'a>`                                                                                                                                            |
| `f.context().comments()`                                             | `f.comments()`                                                                                                                                                  |
| `f.context().source_type().is_typescript()`                          | `!f.file().is_javascript()`                                                                                                                                     |
| `token("(")`                                                         | `"("`                                                                                                                                                           |
| `text(s)`, `text_without_whitespace(s)`                              | the same, with `&[u8]`. No copy if the slice is part of the source. `source_text(span)` is cheaper still, for a token without line breaks or tabs               |
| `f.allocator().alloc_str(..)` + `text(..)`                           | `text(&owned)` copies. `f.write_built_text(\|out\| ..)` builds in place                                                                                         |
| `format_once(\|f\| ..)`                                              | `format_with(\|f\| ..)` wherever the closure can be `Fn`                                                                                                        |
| `VecBuffer::new(f.state_mut())` .. `into_vec()`                      | `f.capture(&content) -> Interned`, `f.intern(&content) -> Option<FormatElement>`, `f.write_into(&mut vec, &content)` with `f.take_vec()` / `f.recycle_vec(vec)` |
| `RemoveSoftLinesBuffer::new(f)`                                      | `f.write_without_soft_lines(&content)`                                                                                                                          |
| `buffer.start_recording()` .. `stop()`                               | `let start = f.elements().len(); ..; f.elements_from(start)`                                                                                                    |
| `element.will_break()`                                               | `element.will_break(f)`                                                                                                                                         |
| `memoized.inspect(f).will_break()`                                   | the same                                                                                                                                                        |
| `BestFittingElement::from_vec_unchecked(..)`                         | `f.best_fitting_of(&[Interned])`                                                                                                                                |
| write to a buffer to learn something, then wrap it in a group or not | `let slot = f.reserve_tag(); ..write..; f.group_from(slot, should_expand)`, or leave the slot alone. See `AssignmentLike::fmt`                                  |
| `Vec`, `ArenaVec` for a handful of things                            | `SmallVec<[T; 4]>`                                                                                                                                              |

### Nodes

oxc: `impl FormatWrite for AstNode<'a, IfStatement<'a>> { fn write(&self, f) }`. Here: a free function that gets the handle and its parts, `write_if_statement(statement, test, consequent, alternate, f)`, called from the `match` in `format.rs`.

`AstNode<'a, T>` with its `parent` pointer does not exist. Handles are `Copy` and know their file. **`AstNodes<'a>`** (`js/ast_nodes.rs`) is a view with oxc's variant names, made on demand:

```rust
e.as_ast_nodes()             // AstNodes::CallExpression(e), ..
e.ast_parent()               // what oxc's `self.parent()` is
node.parent(), node.span(), node.ancestors()
matches!(e.ast_parent(), AstNodes::ExpressionStatement(s) if s.is_arrow_function_body())
```

Every variant has one field, the handle. It emulates the nodes that oxc has and the HIR has not: `ChainExpression`, `FunctionBody`, `FormalParameters`, `ClassBody`, `TSTypeAnnotation`, `TSTypeParameterInstantiation`/`Declaration`, `JSXExpressionContainer`, `JSXOpeningElement`, `ExportNamedDeclaration`/`ExportDefaultDeclaration` around a declaration, `CatchClause`, `Decorator`, `SequenceExpression` (the HIR has nested commas), the arrow body's `ExpressionStatement`, and the assignment target kinds.

| oxc                                                                                                       | here                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `match expr.as_ref() { Expression::X(x) => .. }`                                                          | `match e.kind() { ExprKind::X .. }`. **If X is a member access, a call or `!`**, use `e.as_ast_nodes()`: see below                |
| `self.parent()` in the code for one kind of node                                                          | `e.ast_parent()`. For a member access, a call or `!`: `e.as_chain_element().parent()`                                             |
| `self.grand_parent()`                                                                                     | `e.ast_parent().parent()`                                                                                                         |
| `call.callee()`, `member.object()`, `binary.left()`, `cond.test()`, `unary.argument()`, `as.expression()` | the same names on `Expr`, from `ExprFields` (`js/fields.rs`), returning `Option`. Or destructure `e.kind()`                       |
| `x.span() == y.span()` to ask "is x the test of y?"                                                       | `x == y`: handles compare by identity                                                                                             |
| `parent.is_call_like_callee_span(span)`                                                                   | `parent.is_call_like_callee(e)`                                                                                                   |
| `node.needs_parentheses(f)`                                                                               | `parentheses::expression::needs_parentheses(e, f)`, `parentheses::ts_type::needs_parentheses(ty, f)`                              |
| `node.write(f)` (without comments and parentheses)                                                        | `write_expression(e, ExprOptions::None, f)`, `write_declaration(stmt, f)`, `write_type(ty, f)`                                    |
| `node.format_leading_comments(f)`                                                                         | `format_leading_comments(span).fmt(f)`                                                                                            |
| `node.format_trailing_comments(f)`                                                                        | `write_trailing_comments_of(node, f)`                                                                                             |
| `self.id()`, `member.property()`: an identifier node                                                      | `identifier(ident, parent_node)`. Names are `Ident`s, not nodes                                                                   |
| `property.key()`                                                                                          | `FormatKey::new(key, parent_node)`, `format_computed_or_property_key(..)` in `utils/object.rs`                                    |
| `self.type_annotation()` (`: T`)                                                                          | `x.ty().map(FormatTypeAnnotation)`                                                                                                |
| `self.type_parameters()`, `self.type_arguments()`                                                         | `type_parameters(list, owner)`, `type_arguments(list, owner)` in `print/type_parameters.rs`. They write nothing for an empty list |
| `self.params()`, `self.body()` of a function                                                              | `FormatFormalParameters(func)`, `FormatFunctionBody(func)`                                                                        |
| `self.decorators()`                                                                                       | `FormatDecorators::new(iter, parent_node)`                                                                                        |
| `arrow.fmt_with_options(options, f)`                                                                      | `FormatExpr::with_options(e, ExprOptions::Arrow(options))`                                                                        |
| `declare`, `abstract`, `readonly`, .. fields                                                              | `x.modifiers().iter().any(\|m\| m.flag() == Flags::X)`. `x.flags()` also has what is inherited (`AMBIENT` in a `.d.ts`)           |

### Optional chains

`a?.b.c` is two nodes in ESTree, a `ChainExpression` and the member expression in it, and one `Expr` here.

- `e.as_ast_nodes()` is ESTree's `Expression`: `ChainExpression(e)` if `e` is the whole of a chain (`is_chain_root(e)`).
- `e.as_chain_element()` is the member access, the call or the `!` itself. Its `parent()` is the `ChainExpression`.

So oxc's `matches!(callee, Expression::StaticMemberExpression(_))`, which is false for `(a?.b)()`, is `matches!(callee.as_ast_nodes(), AstNodes::StaticMemberExpression(_))`, not `matches!(callee.kind(), ExprKind::Dot { .. })`.

### One lifetime

`File<'a>` is invariant in `'a`. A function that takes two handles, or a handle and the formatter, needs **one** lifetime for them: `fn f<'a>(a: Expr<'a>, b: List<'a, Expr<'a>>, f: &Formatter<'a>)`. With `'_` twice it does not compile ("lifetime may not live long enough"). The same for closures: annotate `|e: Expr<'a>|`, or make it a nested `fn`.

## Comments

The algorithm is oxc's, not Prettier's: comments are not attached to nodes up front. `Comments` is a **cursor** over the sorted comments of the file. Whoever formats a position asks for "the unprinted comments before X" and prints them, which advances the cursor. So:

- Nodes have to be formatted **in source order**. If something is formatted ahead of its turn to look at it (`memoized().inspect(f)`, `f.intern`), everything before it has to be formatted first, and the result has to be used, not thrown away. To throw it away: `f.speculate_will_break(&content)`, which restores the cursor.
- A comment that nobody asks for is printed by the next node as a leading comment.
- `impl Format for <handle>` prints leading comments (all unprinted ones before `span.start`), the node, then trailing comments: `Comments::get_trailing_comments(enclosing_span, preceding_span, following_span_start)` decides how many of the next comments belong to this node and not to the next sibling. The parent's span and the next sibling come from `AstNodes::parent()` and `siblings.rs`, and are only computed if there is a comment nearby.
- Dangling comments (`{ /* here */ }`) are printed by the function that writes the node: `format_dangling_comments(span).with_block_indent()`.
- `FormatNodeWithoutTrailingComments(&x)` leaves the comments after `x` to the caller.
- `// prettier-ignore`, and in the flavor of oxfmt `// oxfmt-ignore` (`Flavor::is_ignore_comment`, for every language): `f.comments().is_suppressed(span.start)` → `FormatSuppressedNode(span)` prints the source text.
- Where Prettier attaches a comment to a node that it is not next to (`handleMemberExpressionComments`, a comment before the `(` of a signature), `comments::collect` ends with `move_comments`: the comment gets a position that it counts as being at, `Comment::start()`/`end()` (zero width, `is_moved()`), and the list is sorted by that. `comment.span` stays where the text is. All queries of `Comments` go by `start()`/`end()`. A moved comment at the very end of a node is behind it: `comments_before_end_of(span)`.
- `/** @type {T} */ (e)`: `utils/typecast.rs` keeps the parentheses.

### `f.is_quiet()`

Most nodes have no comment anywhere near. While a node is written whose span has no unprinted comment and none behind it on the same line, `f.is_quiet()` is true, and the wrappers in `format.rs` skip all of the above. Use it to skip work that is only about comments:

```rust
if !f.is_quiet() { let comments = f.comments().comments_before_character(start, b'='); .. }
```

Calling the `Comments` methods without the check is always correct: they are cheap when the next comment is far away.

## Performance rules

The goal is to be faster per core than oxfmt and Biome.

- No heap allocation per node. `SmallVec` for lists that are small in practice, `f.take_vec()` for element buffers.
- No `String`, no `format!`, no `to_vec()` on the path of ordinary code. Text is `&[u8]`.
- `format_with` closures and `format_args!` are static dispatch and cost nothing. `&dyn Format` only where oxc needs it (`best_fitting!`).
- `as_ast_nodes()`, `ast_parent()` are cheap but not free (a table lookup and a `match`). Ask once, keep the result in a `let`.
- `memoized()`/`intern`/`capture` move nothing: the elements stay where they are written, behind a `FormatElement::Skip(len)`, and an `Interned` is a range of the one vector. What is formatted and thrown away stays there too.
- Decide from the syntax first, look at the source text or the comments last.
- Sort with `crate::sort` (`bun_collections::index_sort`), not with `slice::sort*`: each `sort_by` with a closure of its own is 4 to 30 KB of code in the binary. The standard sorts are for a sort that a profile shows to be hot.

## Conventions

Those of `src/CLAUDE.md` and `src/lint/CLAUDE.md`: no `unsafe`, nothing that can panic on any input (`.get()`, `let .. else`, `saturating_sub`), byte searches through `bun_core::strings`, no `std::fs`/`println!`, `pub(crate)`, no warnings. Comments say what the reader cannot see, in the present tense, and never narrate the port. Naming Prettier's function that something corresponds to is good: ``/// Prettier's `shouldHugTheOnlyFunctionParameter`.``

A node that is not ported yet is written as it is in the source: `write!(f, FormatSuppressedNode(span))`.

## Testing

`B` is the `bun-lint` binary (the crate `bun_lint_standalone`, `src/lint/standalone/format_cmd.rs`), `P` a checkout of Prettier at the tag 3.9.9.

```sh
$B format file a.ts --semi=false --printWidth=100     # format one file
$B format ir a.ts                                      # the document
$B format conformance <(zstd -dc test/cli/format/prettier/bundle.zst)   # or $P/tests/format: table per directory, totals, what is not run and why
$B format conformance $P/tests/format --languages=css --table
$B format conformance $P/tests/format --filter=js/arrow --report=report
diff -u report/<case>.expected report/<case>.actual
$B format check-idempotent <files or directories>
$B format verify <files or directories>                # the same program before and after
$B format bench <files or directories>
bun test/cli/format/oracle/compare.ts --bin=$B --prettier=<dir with node_modules/prettier> --options='{"semi":false}' <dirs>
$B format oxfmt-fixtures <(zstd -dc test/cli/format/oxfmt/bundle.zst)   # oxfmt's fixtures, judged by Prettier and, with its flavor, by oxfmt
```

`conformance` makes the six checks of Prettier's own runner for every fixture and set of options: the snapshot, that what Prettier rejects is rejected, a second format, CRLF, CR, a byte order mark. `EXCLUDED` in `src/format/conformance/prettier.rs` is all that it leaves out, with the reason. `test/cli/format/{prettier,oxfmt}/expected.txt` is what the two commands printed when the files were last written. `test/cli/format/conformance.test.ts` is red if a check fails that is not in them, or if more is left out than they say. What is in them and passes by now is no reason to be red, so a fix need not come with them.

`test/cli/format/own/cases` has small inputs of our own for what only real code or a fuzzer has shown, with what Prettier and oxfmt print. **A fix of that kind comes with its input**, in the same commit. None of them fails, so there is no list of expected failures: see its README.

Fixtures show a fraction of what differs. What found the rest: real code through `compare.ts`, and fuzzers that put every kind of expression into every kind of parent, a comment of every form into every gap of a statement, and random JSX children at narrow widths, each against the npm package.

To see Prettier's document for a snippet: `prettier --parser babel --debug-print-doc a.js`. It maps one to one: `group`, `indent`, `line` (`soft_line_break_or_space`), `softline` (`soft_line_break`), `hardline`, `ifBreak(a, b)` (`if_group_breaks(a)`, `if_group_fits_on_line(b)`), `conditionalGroup` (`best_fitting!`), `fill`, `lineSuffix`, `lineSuffixBoundary`, `breakParent` (`expand_parent`), `indentIfBreak`, `align`, `label`.

## The oxfmt flavor

`f.options().flavor.is_oxfmt()`: whoever has an `.oxfmtrc.json` gets what oxfmt prints where that is not what Prettier 3.9.9 prints, so that switching gives no diff. oxfmt follows Prettier 3.8 in those places, or has a rule of its own. Each is behind a function next to its use that is named after the behaviour (`union_breaks_one_per_line(f)`), to be deleted when oxfmt catches up. The default flavor must not change because of one. MDX is Prettier's in both flavors: oxfmt hands it to the Prettier that it brings along.

## `sortTailwindcss` and `prettier-plugin-tailwindcss`

oxfmt's option, and the plugin of Prettier that it is made of: the classes of Tailwind CSS in a text are put in the order of their rules. `Tailwind::follows_plugin` says which of the two it is. They differ in programs only.

- **One function**: `tailwind.rs::Tailwind::sorted_between` is `sortClasses` and `sortClassList` of `prettier-plugin-tailwindcss`, which everything in oxfmt ends in. A language only says where a text with classes is, and what is at its ends (`Ends`).
- **The order** is known to the Tailwind of the project alone, which is JavaScript. The formatter asks `Orders` for the ranks of a list of classes. The driver implements it (`src/lint/driver/fmt/tailwind.rs`): a class that is not known is noted, the text stays as it is, and `Tailwind::has_missed` says that what has been printed is of no use. The driver puts such a file aside, asks once for all classes (`tailwind.js`, run by `evaluate.rs`), and formats those files again. Where Tailwind 3 and 4 put a class does not depend on what else they are asked about (27,345 real lists: no pair in another order), only the numbers that they answer with do, so all classes are asked about at once. The answer is kept in `node_modules/.cache/bun-format` for as long as what Tailwind has loaded stays the same: most runs start no script. So the formatter is what collects the classes, and nothing is run for files without any. What is sorted is not sorted again further down: that would ask for a list that only the second pass knows of.
- **JavaScript, for the plugin**: `tailwind/plugin.rs::sorted_text`, its `transformJavaScript`. The plugin changes the tree before Prettier prints it, so this changes the text, and a file whose classes move is parsed again, as for the plugins that sort imports.
- **JavaScript, for oxfmt**: `js/utils/tailwindcss.rs`, a port of oxc's, with its stack of contexts (`JsFormatContext::tailwind_context`) and what follows from it: no context for the arguments of a call that is written as a member chain, a text of a template is sorted in a call of another function and a string is not.
- **Style sheets**: `@apply`, in `print_at_rule_up_to_block`.
- **Handlebars**: the plugin changes the tree, and so does `handlebars/tailwind.rs`.
- **HTML, Vue and Angular**: the plugin rewrites the values of attributes in the tree, so `html/tailwind.rs` rewrites the text before it is parsed. Of the code in HTML the plugin takes over programs and `__js_expression`, nothing else: `js.rs::with_file`.
- **The checks before writing** know that words change places and that one that is there twice is there once: `verify/tree.rs::has_same_words`. HTML is compared without the option: `html::has_same_content`.
- **Not there**: with `preserveWhitespace`, a line break in a list does not break the groups around it in oxfmt. oxfmt does not sort in the cells of a `test.each` table. Without the package oxfmt takes a Tailwind that the plugin brings along, also for `config` with version 4 installed.
- **Tests**: `test/cli/format/tailwind`, with a stand-in for the package. `test/cli/format/oracle/tailwind/make-fixtures.ts` makes what is expected with the real tools.

## Pitfalls

- oxc tracks an older release of Prettier (3.8). Where they differ, the snapshot of 3.9.9 is right.
- `Expr::span()` is without parentheses, like in ESTree. `e.outer_span()` has them.
- A backtick string without substitutions is `ExprKind::Template`. JSX text is `ExprKind::String` with `e.is_jsx_text()`.
- `a, b, c` is `Binary { op: Comma }`, left-nested. `e.sequence()` are the operands. `BinaryLikeExpression::new(e)` is `None` for it. `#a in b` is a binary-like expression (`AstNodes::PrivateInExpression` tells it apart).
- Patterns in declarations are `Pat`. In assignments they are expressions: `is_assignment_target(e)`, and `as_ast_nodes()` says `ArrayAssignmentTarget`, ..
- `export` is a modifier of the declaration. `stmt.as_ast_nodes()` is the `ExportNamedDeclaration`, `FormatDeclaration(stmt)` the declaration in it, `stmt.span_without_export()` its span.
- Methods: `member.func()` / `prop.func()` is the function, whose span starts at the parameters in ESTree.
- Elements of `implements` and of the `extends` of an interface are `TypeKind::Ref`, or `TypeKind::Heritage` if they are not names.
- `x!!` is one `ExprKind::NonNull(x)`. `FormatNonNullMarks(e)` writes every `!` and the comments between them.
