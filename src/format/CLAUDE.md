# `bun format`

A formatter for JavaScript, JSX and TypeScript whose output is byte for byte that of Prettier 3.

- **The specification is Prettier**: `src/language-js/**`, `src/document/**`, `src/main/comments/**`, and its snapshot tests, `tests/format/{js,jsx,typescript}/**/__snapshots__/format.test.js.snap`.
- **The code is a port of oxc's formatter** (`crates/oxc_formatter_core`, `crates/oxc_formatter`), which is a port of Biome's, which is modelled on Prettier. Where oxc deviates from Prettier, Prettier wins. Both are MIT licensed. See the crate docs in `lib.rs`.
- **There is no AST of its own**. It prints straight from the type checker's HIR through the handles of `bun_lint::ast` (`src/lint/CLAUDE.md` has the table ESTree → handles).

Not there, on purpose: formatting of embedded languages (CSS, GraphQL, HTML, Markdown in templates: they are printed as they are), JSDoc formatting, import sorting, Tailwind class sorting, Vue/Svelte/Angular, range formatting, pragmas, `experimentalTernaries`, `experimentalOperatorPosition: "start"`.

## The pipeline

```
File (HIR + binder tables)                     bun_lint::ast
  └─ js::comments::collect   → [Comment]       all comments, in order, with what is around them
  └─ js::format_file         → [FormatElement] the document (IR): core/element.rs
  └─ core::document::propagate_expand          a group with a forced line break in it is broken
  └─ core::printer::print    → bytes           decides which groups fit on the line
```

`lib.rs` has the entry points: `format(file, &options, &mut scratch, &mut out)`. `Scratch` holds every buffer, so that formatting the next file allocates nothing.

| directory | what | oxc |
| --- | --- | --- |
| `core/` | the IR, `Formatter`, builders (`group`, `indent`, `soft_line_break`, ..), macros, the printer. Knows nothing about JavaScript except `Formatter::context` | `oxc_formatter_core` |
| `options.rs` | `FormatOptions`, with oxc's field and type names, and `set("semi", "false")` with Prettier's | `oxc_formatter/src/options.rs` |
| `js/format.rs` | `impl Format for Expr, Stmt, TypeNode, ..`: comments, `prettier-ignore`, parentheses, then dispatch to `js/print/` | the generated `ast_nodes/generated/format.rs` |
| `js/ast_nodes.rs`, `fields.rs`, `siblings.rs` | the tree as oxc sees it: `AstNodes`, `parent()`, `span()`, field accessors, the next sibling | `ast_nodes/` |
| `js/comments.rs`, `trivia.rs` | which comments are printed where | `formatter/comments.rs`, `formatter/trivia.rs` |
| `js/parentheses/` | `needs_parentheses` | `parentheses/` |
| `js/print/` | one function per kind of node | `print/` |
| `js/utils/` | what several kinds of nodes share: assignments, member chains, conditionals, strings, numbers | `utils/` |
| `verify.rs` | a check that formatting did not change the tokens | `detect_code_removal` (different) |

## oxc file → our file

Same name unless listed. `print/mod.rs` of oxc (1900 lines) is split:

| oxc `print/mod.rs` | here |
| --- | --- |
| identifiers, `this`, objects, properties, unary, update, `await`, `yield`, chain, assignment targets, `<T>e`, `e!` | `print/expressions.rs`, and the one-liners in `format.rs::write_expression` |
| statements: `if`, loops, `break`, labels, `with`, expression statements | `print/statements.rs` |
| binding patterns, `array_pattern.rs`, `binding_property_list.rs`, `assignment_pattern_property_list.rs` | `print/patterns.rs`, `print/object_pattern_like.rs`, `print/expressions.rs` |
| literals | `print/literals.rs` |
| enums, interfaces, modules, `import =`, `export =` | `print/ts_declarations.rs` |
| keyword types, references, literals, signatures, predicates, `typeof`, `import()` types | `print/ts_types.rs`, and the one-liners in `format.rs::write_type` |
| `template/mod.rs` | `print/template.rs` (`template/embed/` is not ported) |
| `oxc_syntax` operators and precedence | `utils/operators.rs` |
| `oxc_formatter_core` `buffer.rs`, `arguments.rs`, `state.rs`, `format_extensions.rs` | `core/formatter.rs` |

## How the code differs from oxc's

### The IR

`FormatElement` is 16 bytes and `Copy`. There is no arena and there are no lifetimes in it: text is a range of the source (`SourceText`), a range of `Storage::text` (`OwnedText`), or up to 14 bytes inline (`Token`). Interned content is a range of `Storage::pool`.

### `Formatter` is concrete

No `dyn Buffer`, no generic context. `f: &mut Formatter<'a>`, where `'a` is the lifetime of the file.

| oxc | here |
| --- | --- |
| `write!(f, [a, b])`, `write!(f, a)` | the same. **Import the macros by name**: `use crate::{write, format_args, best_fitting};` next to `use crate::prelude::*;` |
| `impl Format<'a, JsFormatContext<'a>> for X` | `impl<'a> Format<'a> for X` |
| `&mut JsFormatter<'_, 'a>` | `&mut Formatter<'a>` |
| `f.context().comments()` | `f.comments()` |
| `f.context().source_type().is_typescript()` | `!f.file().is_javascript()` |
| `token("(")` | `"("` |
| `text(s)`, `text_without_whitespace(s)` | the same, with `&[u8]`. No copy if the slice is part of the source. `source_text(span)` is cheaper still, for a token without line breaks or tabs |
| `f.allocator().alloc_str(..)` + `text(..)` | `text(&owned)` copies. `f.write_built_text(\|out\| ..)` builds in place |
| `format_once(\|f\| ..)` | `format_with(\|f\| ..)` wherever the closure can be `Fn` |
| `VecBuffer::new(f.state_mut())` .. `into_vec()` | `f.capture(&content) -> Interned`, `f.intern(&content) -> Option<FormatElement>`, `f.write_into(&mut vec, &content)` with `f.take_vec()` / `f.recycle_vec(vec)` |
| `RemoveSoftLinesBuffer::new(f)` | `f.write_without_soft_lines(&content)` |
| `buffer.start_recording()` .. `stop()` | `let start = f.elements().len(); ..; f.elements_from(start)` |
| `element.will_break()` | `element.will_break(f)` |
| `memoized.inspect(f).will_break()` | the same |
| `BestFittingElement::from_vec_unchecked(..)` | `f.best_fitting_of(&[Interned])` |
| write to a buffer to learn something, then wrap it in a group or not | `let slot = f.reserve_tag(); ..write..; f.group_from(slot, should_expand)`, or leave the slot alone. See `AssignmentLike::fmt` |
| `Vec`, `ArenaVec` for a handful of things | `SmallVec<[T; 4]>` |

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

| oxc | here |
| --- | --- |
| `match expr.as_ref() { Expression::X(x) => .. }` | `match e.kind() { ExprKind::X .. }`. **If X is a member access, a call or `!`**, use `e.as_ast_nodes()`: see below |
| `self.parent()` in the code for one kind of node | `e.ast_parent()`. For a member access, a call or `!`: `e.as_chain_element().parent()` |
| `self.grand_parent()` | `e.ast_parent().parent()` |
| `call.callee()`, `member.object()`, `binary.left()`, `cond.test()`, `unary.argument()`, `as.expression()` | the same names on `Expr`, from `ExprFields` (`js/fields.rs`), returning `Option`. Or destructure `e.kind()` |
| `x.span() == y.span()` to ask "is x the test of y?" | `x == y`: handles compare by identity |
| `parent.is_call_like_callee_span(span)` | `parent.is_call_like_callee(e)` |
| `node.needs_parentheses(f)` | `parentheses::expression::needs_parentheses(e, f)`, `parentheses::ts_type::needs_parentheses(ty, f)` |
| `node.write(f)` (without comments and parentheses) | `write_expression(e, ExprOptions::None, f)`, `write_declaration(stmt, f)`, `write_type(ty, f)` |
| `node.format_leading_comments(f)` | `format_leading_comments(span).fmt(f)` |
| `node.format_trailing_comments(f)` | `write_trailing_comments_of(node, f)` |
| `self.id()`, `member.property()`: an identifier node | `identifier(ident, parent_node)`. Names are `Ident`s, not nodes |
| `property.key()` | `FormatKey::new(key, parent_node)`, `format_property_key(key, parent_node, f)` in `utils/object.rs` |
| `self.type_annotation()` (`: T`) | `x.ty().map(FormatTypeAnnotation)` |
| `self.type_parameters()`, `self.type_arguments()` | `type_parameters(list, owner)`, `type_arguments(list, owner)` in `print/type_parameters.rs`. They write nothing for an empty list |
| `self.params()`, `self.body()` of a function | `FormatFormalParameters(func)`, `FormatFunctionBody(func)` |
| `self.decorators()` | `FormatDecorators::new(iter, parent_node)` |
| `arrow.fmt_with_options(options, f)` | `FormatExpr::with_options(e, ExprOptions::Arrow(options))` |
| `declare`, `abstract`, `readonly`, .. fields | `x.modifiers().iter().any(\|m\| m.flag() == Flags::X)`. `x.flags()` also has what is inherited (`AMBIENT` in a `.d.ts`) |

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
- `// prettier-ignore`: `f.comments().is_suppressed(span.start)` → `FormatSuppressedNode(span)` prints the source text.
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
- `memoized()`/`intern` move elements to the pool: use them where content is written twice or inspected, not by default.
- Decide from the syntax first, look at the source text or the comments last.

## Conventions

Those of `src/CLAUDE.md` and `src/lint/CLAUDE.md`: no `unsafe`, nothing that can panic on any input (`.get()`, `let .. else`, `saturating_sub`), byte searches through `bun_core::strings`, no `std::fs`/`println!`, `pub(crate)`, no warnings. Comments say what the reader cannot see, in the present tense, and never narrate the port. Naming Prettier's function that something corresponds to is good: `` /// Prettier's `shouldHugTheOnlyFunctionParameter`. ``

A node that is not ported yet is written as it is in the source: `write!(f, FormatSuppressedNode(span))`.

## Testing

`B` is the `bun-lint` binary (the crate `bun_lint_standalone`, `src/lint/standalone/format_cmd.rs`), `P` a checkout of Prettier.

```sh
$B format file a.ts --semi=false --printWidth=100     # format one file
$B format ir a.ts                                      # the document
$B format conformance $P/tests/format                  # table per directory, totals
$B format conformance $P/tests/format --filter=js/arrow --report=report
diff -u report/<case>.expected report/<case>.actual
$B format check-idempotent <files or directories>
$B format verify <files or directories>                # same tokens before and after
$B format bench <files or directories>
bun test/cli/format/oracle/compare.ts --bin=$B --prettier=<dir with node_modules/prettier> --options='{"semi":false}' <dirs>
```

To see Prettier's document for a snippet: `prettier --parser babel --debug-print-doc a.js`. It maps one to one: `group`, `indent`, `line` (`soft_line_break_or_space`), `softline` (`soft_line_break`), `hardline`, `ifBreak(a, b)` (`if_group_breaks(a)`, `if_group_fits_on_line(b)`), `conditionalGroup` (`best_fitting!`), `fill`, `lineSuffix`, `lineSuffixBoundary`, `breakParent` (`expand_parent`), `indentIfBreak`, `align`, `label`.

## Pitfalls

- The fixtures are those of Prettier's `main` (3.10-dev). oxc tracks a release. Where they differ, the snapshot is right.
- `Expr::span()` is without parentheses, like in ESTree. `e.outer_span()` has them.
- A backtick string without substitutions is `ExprKind::Template`. JSX text is `ExprKind::String` with `e.is_jsx_text()`.
- `a, b, c` is `Binary { op: Comma }`, left-nested. `e.sequence()` are the operands. `BinaryLikeExpression::new(e)` is `None` for it, and for `#a in b`.
- Patterns in declarations are `Pat`. In assignments they are expressions: `is_assignment_target(e)`, and `as_ast_nodes()` says `ArrayAssignmentTarget`, ..
- `export` is a modifier of the declaration. `stmt.as_ast_nodes()` is the `ExportNamedDeclaration`, `FormatDeclaration(stmt)` the declaration in it, `stmt.span_without_export()` its span.
- Methods: `member.func()` / `prop.func()` is the function, whose span starts at the parameters in ESTree.
- Elements of `implements` and of the `extends` of an interface are `TypeKind::Ref`, or `TypeKind::Heritage` if they are not names.
