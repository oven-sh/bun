# `bun lint`

A linter that is compatible with ESLint and typescript-eslint: the same rule names, options, messages, report locations, fixes and `eslint-disable` comments. Rules are written in Rust against the HIR and binder output that `bun check` already produces. **Nothing is converted to ESTree**, and no rule or helper may build or query an ESTree tree or esquery selectors: that is for a later JavaScript plugin API. (The ESTree serializer in `standalone/` is a test oracle for the syntax layer.) Design goals, in order: correct (matches ESLint), fast, pleasant to write rules in.

## Layout

| Path | Crate | What |
| --- | --- | --- |
| `src/lint/` | `bun_lint` | The API: `ast/`, `semantic/`, `tokens/`, `types`, `code_path`, `regex`, `rule.rs`, `context.rs`, `fix.rs`, `options.rs`, `utils/`, `runner.rs` |
| `src/lint/eslint/rules/*.rs` | `bun_lint_eslint` | One file per ESLint core rule |
| `src/lint/typescript/rules/*.rs` | `bun_lint_typescript` | One file per typescript-eslint rule |
| `src/lint/standalone/` | `bun_lint_standalone` | `bun-lint`, the test harness. Links without the rest of Bun |
| `test/cli/lint/conformance/fixtures/` | | Upstream test cases as JSON, with what real ESLint reports for each |

## Writing a rule

Read `rule.rs` (module docs) first, then `ast/mod.rs`. `eslint/rules/{no_debugger,eqeqeq,max_depth,no_cond_assign}.rs` are the examples to imitate.

- File `no_foo_bar.rs`, struct `NoFooBar`, `Meta::eslint("no-foo-bar", ..)` / `Meta::typescript(..)`. `use bun_lint::prelude::*;`
- The struct holds the parsed options and nothing else. It is shared by all threads. Per-file state is `type State<'a>`, returned by `register`, reached as `cx.state`.
- One `const NAME: Message = Message::new("messageId", "Text with {{placeholders}}.")` per upstream message, with upstream's `messageId` and text verbatim.
- `Meta` mirrors upstream `meta`: `kind`, `.fixable(..)`, `.has_suggestions()`, `.recommended()` / `.presets(..)`, `.requires_types()`, `.deprecated()`, `.extends_base_rule(..)`.
- Options: apply upstream's `defaultOptions` / schema defaults by hand in `new`. `options.object(0)` is empty when missing, so every lookup falls back to the default.
- The doc comment on the struct is upstream's `meta.docs.description`.
- Port the behaviour of the upstream JavaScript/TypeScript rule, not oxc's. oxc's Rust port of the same rule is useful for ideas, but it deviates from ESLint in places and its AST is different.

### Listeners, and why they look the way they do

The HIR keeps the nodes of a file in one vector per sort. So:

- `on.exprs([ExprTag::Call], f)`, `on.stmts(..)`, `on.types(..)`, `on.pats(..)`, `on.funcs(f)`, `on.classes(f)`, `on.members(f)`, `on.props(f)`, `on.params(f)`, `on.var_decls(f)`, `on.cases(f)`, `on.symbols(f)`, ..: `f` runs in a tight loop over exactly those nodes, **in no particular order**. No tree walk. **This is the default. Use it unless the rule cannot work without order.**
- `on.enter(tags, f)` / `on.exit(tags, f)`: source order, around the children. The nodes of the listened kinds are collected and sorted by span, so it costs in proportion to how many there are: fine for functions, classes, loops and blocks, wasteful for identifiers. Use it for rules that are inherently about nesting order.
- Code path listeners (`on.code_path_start(..)`, ..) make the linter walk and analyze the whole file. Register them only if the file can have something to report: `file.has_stmts([StmtTag::Switch])`, `file.has_exprs(..)`, `file.has_classes()`.
- `on.string_literals(f)` / `on.number_literals(f)`: every ESTree `Literal` that is a string / a number, as a `Literal` (`span()`, `text()`, `owner()`). Only some are expressions here: the others are keys, literal types, module specifiers, names in quotes of imports and exports. Use these instead of listing the places by hand.
- In `register`, `file.has_exprs(..)`, `file.has_stmts(..)`, `file.exprs_of_kind(tag)`, `file.stmts_of_kind(tag)`, `file.funcs()` tell whether there is anything to listen for.
- `on.finish(f)`: once at the end. Collect in `cx.state` from unordered listeners, decide here.
- ESLint rules often keep a stack only to know "which function/class/loop am I in". Do not port the stack: ask the node (`node.enclosing_function()`, `node.ancestors()`, `func.enclosing()`, `func.returns()`, `func.yields()`). `func.contains_this()` is TypeScript's notion, not ESLint's: it counts `this` types, and a `this` in a computed key or a decorator of a method counts for the method.
- Reports are sorted by position afterwards, so the order of reporting does not matter.

### Performance rules

- Decide from the syntax first. Touch tokens, comments, line/column, references, scopes and types only when the cheap checks have passed: each of these is computed lazily for the whole file on first use.
- `expr.symbol()` is a load. `symbol.declarations()`, `node.scope()`, `scope.symbols()/get/resolve` compute the scopes and variables of the file on first use (~1.6 ms/MB); `symbol.references()`, `expr.reference()`, `file.unresolved_references()` also the references (~1.3 ms/MB more). For comparison, parsing and binding is ~25 ms/MB.
- `skip_trivia_back` takes a token that ends in `*/`, like the regex `/a*/`, for a comment. Where that can be, use `file.token_before(..)`.
- `skip_trivia(text, end_of_node)` finds the next token after a node without scanning the file. `expr.operator_span()`, `func.open_paren()`, `func.arrow_span()`, `func.body_span()`, `class.body_span()`, `call.close_paren()` are positions the HIR already has or finds locally.
- No allocation on the path that reports nothing. No `format!`, `to_vec`, `collect` before you know there is a report.
- Compare `Name`s with each other (`a == b` is an integer compare), or with text by `name.is("x")` / `name.is_any(&[..])` / `match name.bytes() { b"x" => .. }`.
- `.fix(|fixer| ..)` and `.suggest(..)` closures only run when fixes are wanted. Put all fix computation inside them.

### Code conventions (Bun-wide, enforced by CI)

- No `unsafe`. No `.unwrap()`/`.expect()`/indexing that user input can make panic: use `let .. else`, `?`, `.get()`.
- Text is `&[u8]`. Searching goes through `bun_core::strings` (`index_of`, `index_of_char_usize`, `index_of_any`, `contains`, `contains_char`, `last_index_of_char`, `split`, ..): `str::find/rfind/contains/split*/replace*/matches`, `slice::windows`, `.iter().position(|b| *b == b'x')`, `.contains(&b'x')` are denied by lints. `==`, `starts_with`, `ends_with`, `trim_ascii`, `eq_ignore_ascii_case` are fine.
- No `std::fs`, `std::path`, `std::env`, `println!` outside `standalone/`.
- Every warning is an error: no unused imports, variables, `mut`, dead code. `pub` only for what another crate uses, otherwise `pub(crate)` or private. (The rule struct and a struct used as its `State<'a>` have to be `pub`.)
- The clippy lints in `[workspace.lints.clippy]` are denied too. The ones that bite: `derive_partial_eq_without_eq`, `or_fun_call` (`.or_else(|| f())`, not `.or(f())`), `needless_pass_by_value`, `redundant_clone`, `trivially_copy_pass_by_ref`, `needless_collect`.
- Comments: only what the next reader could not work out quickly. Never narrate the port, never reference ESLint line numbers. Naming the upstream helper a function corresponds to (`` /// ESLint's `isLoop` ``) is good.
- Let-chains (`if let Some(x) = a && let Some(y) = b`) are available and preferred over nesting.

## ESTree → this API

ESLint's rules, docs and tests speak ESTree (TSESTree for TypeScript). The mapping:

| ESTree | Here |
| --- | --- |
| `Program` | `&File`, `Node::File`. `file.body()` |
| `Identifier` (a reference) | `ExprKind::Ident(name)` |
| `Identifier` (a binding) | `PatKind::Ident(name)` |
| `Identifier` (any other name: `a.b`, a label, a function name, a key) | `Ident` (name + span), from the accessor of the owner: `ExprKind::Dot { name, .. }`, `func.name()`, `class.name()`, `stmt.label()`, `key.kind()` |
| `Literal` | `ExprKind::{String, Number, BigInt, True, False, Null, Regex}`. `raw` is `expr.text()` |
| `TemplateLiteral`, `TemplateElement` | `ExprKind::Template(t)`, also for `` `a` `` without substitutions (the HIR has a string there, `kind()` and `tag()` say `Template`): `t.exprs()`, `t.cooked(i)`, `t.raw(i)`, `t.quasi_span(i)` |
| `TaggedTemplateExpression` | `ExprKind::TaggedTemplate(call)`: `call.callee()` is the tag, `call.template()` the `Template` |
| `MemberExpression` | `ExprKind::Dot { obj, name, chain }` (`computed: false`, also `a.#b`), `ExprKind::Index { obj, index, chain }` (`computed: true`) |
| `optional: true` | `chain == Chain::Start`, `expr.is_optional()` |
| `ChainExpression` | Not a node. `expr.is_chain_root()`: ESLint has one around this expression, with the same range. `expr.is_in_optional_chain()` |
| `CallExpression`, `NewExpression` | `ExprKind::Call(call)`, `ExprKind::New(call)`: `callee()`, `args()`, `type_args()` |
| `ImportExpression` | `ExprKind::ImportCall { args }`: `source`, `options`. `phase`: `expr.is_deferred_import_call()` |
| `MetaProperty` | `ExprKind::ImportMeta`, `ExprKind::NewTarget`. `meta`, `property`: `expr.meta_property_spans()` |
| `UnaryExpression`, `UpdateExpression` | `ExprKind::Unary { op, operand }` |
| `BinaryExpression`, `LogicalExpression` | `ExprKind::Binary { op, left, right }`. Logical: `BinOp::{And, Or, Nullish}` |
| `SequenceExpression` | `ExprKind::Binary { op: BinOp::Comma, .. }`, left-nested. `expr.sequence()` are ESLint's `expressions` |
| `AssignmentExpression` | `ExprKind::Assign { op, target, value }`. `op: None` is `=` |
| `ArrayPattern` / `ObjectPattern` / `AssignmentPattern` / `RestElement` **in an assignment target** | The literal as parsed: `ExprKind::Array`, `ExprKind::Object`, `ExprKind::Assign` (a default), `ExprKind::Spread` |
| the same **in a declaration or a parameter** | `PatKind::{Array, Object}`, `PatElem`/`PatProp` with `.default()` and `.is_rest()`, `Param` with `.default()` and `.is_rest()` |
| `ConditionalExpression` | `ExprKind::Cond { test, yes, no }` |
| `ArrowFunctionExpression`, `FunctionExpression` | `ExprKind::Fn(func)`, `func.kind()` is `FnKind::Arrow` / `FnKind::Expr` |
| `FunctionDeclaration`, `TSDeclareFunction` | `StmtKind::Fn(func)`, with and without `func.has_body()` |
| `:function` | `on.funcs(..)`, filtered by `func.kind()` and `func.has_body()`: signatures and function types are `Func`s too |
| `BlockStatement` that is a function body | Not a node. `func.body()`, `func.body_span()` |
| `ClassDeclaration`, `ClassExpression` | `StmtKind::Class(class)`, `ExprKind::Class(class)` |
| `ClassBody` | Not a node. `class.members()`, `class.body_span()` |
| `MethodDefinition`, `PropertyDefinition`, `AccessorProperty`, `StaticBlock`, `TSAbstract*`, `TSIndexSignature` | `Member`, by `member.kind()` and `member.flags()` |
| the `FunctionExpression` that is `method.value` | `member.func()` / `prop.func()`. Its ESTree range is `func.span_from_params()` |
| `TSEmptyBodyFunctionExpression` | the same with `!func.has_body()` |
| `Property` (in an object literal) | `Prop`, by `prop.kind()`: `Init`, `Shorthand`, `Method`, `Getter`, `Setter` |
| `SpreadElement` | `ExprKind::Spread(e)` in arrays and calls, `PropKind::Spread` in objects |
| `key`, `computed` | `Key`: `key.kind()`, `key.name()`, `key.is_computed()`, `key.span(file)` |
| `PrivateIdentifier` | `KeyKind::Private`, the `name` of a `Dot` that starts with `#`, `ExprKind::PrivateIdentifier` (left of `in`) |
| `VariableDeclaration`, `VariableDeclarator` | `StmtKind::Var(decls)`, `VarDecl`. `kind` is `decl.var_kind()` |
| `ExpressionStatement`, `directive` | `StmtKind::Expr(e)`, `stmt.directive()`. The `Stmt` in the head of a `for` (`init`, `left`) that is an `Expr` is a wrapper (`stmt.is_wrapper()`), not a node: the parent of `e` is the `for` |
| `IfStatement`, `ForStatement`, .. | `StmtKind::{If, For, ForIn, ForOf, While, DoWhile, Switch, Try, Throw, Return, Break, Continue, Labeled, With, Block, Empty, Debugger}` |
| `SwitchCase` | `Case` |
| `CatchClause` | Not a node. `StmtKind::Try { param, handler, .. }`, `stmt.catch_clause_span()` |
| `ImportDeclaration`, `ImportSpecifier`, `ImportDefaultSpecifier`, `ImportNamespaceSpecifier` | `StmtKind::Import(import)`: `named()` (`ImportSpec`), `default()`, `namespace()` |
| `ExportNamedDeclaration` with specifiers | `StmtKind::ExportNamed(export)`, `ExportSpec` |
| `ExportNamedDeclaration` / `ExportDefaultDeclaration` around a declaration | Not a node. `stmt.is_exported()`, `stmt.is_default_export()`. `stmt.export_span()` is the range of the export, `stmt.span_without_export()` that of the declaration (`stmt.span()` also has decorators before `export`) |
| `ExportDefaultDeclaration` of an expression | `StmtKind::ExportDefault(e)` |
| `ExportAllDeclaration` | `StmtKind::ExportStar { .. }` |
| `JSXElement`, `JSXFragment`, `JSXOpeningElement`, `JSXClosingElement` | `ExprKind::Jsx(jsx)`: `tag()`, `attrs()`, `children()`, `opening_span()`, `closing_span()` |
| `JSXAttribute`, `JSXSpreadAttribute` | `Prop` with `is_jsx_attribute()` |
| `JSXText` | `ExprKind::String` with `expr.is_jsx_text()`. Whitespace with a line break has no `Expr`: `jsx.children_with_whitespace()` |
| `JSXExpressionContainer`, `JSXEmptyExpression` | The expression itself with `expr.jsx_container_span()`. `{}` is `ExprKind::Missing` |
| `TSTypeAnnotation` | Not a node. `.ty()` / `.return_type()` of the owner. Its range: `ty.annotation_span()` |
| `TSAsExpression`, `TSTypeAssertion` | `ExprKind::As` / `AsConst`, told apart by `expr.is_angle_bracket_assertion()` |
| `TSSatisfiesExpression`, `TSNonNullExpression`, `TSInstantiationExpression` | `ExprKind::{Satisfies, NonNull, Instantiation}` |
| `TSTypeReference`, `TSQualifiedName` | `TypeKind::Ref { name: EntityName, args }` |
| `TSTypeParameterInstantiation`, `TSTypeParameterDeclaration` | Not nodes. `type_args()`, `type_params()` lists. Their range: `list.angle_brackets_span()` |
| `TS*Keyword` | `TypeKind::Keyword(Keyword::..)` |
| `TSUnionType`, `TSIntersectionType`, `TSArrayType`, `TSTupleType`, `TSLiteralType`, `TSFunctionType`, `TSConstructorType`, `TSTypeLiteral`, `TSConditionalType`, `TSInferType`, `TSMappedType`, `TSIndexedAccessType`, `TSTypeOperator`, `TSTypeQuery`, `TSImportType`, `TSTypePredicate`, `TSTemplateLiteralType` | the variants of `TypeKind` |
| `TSNamedTupleMember`, `TSOptionalType`, `TSRestType` | `TupleElem` |
| `TSInterfaceDeclaration`, `TSInterfaceBody`, `TSInterfaceHeritage`, `TSClassImplements` | `StmtKind::Interface(i)`: `members()`, `extends()`. `class.implements()` |
| `TSPropertySignature`, `TSMethodSignature`, `TSCallSignatureDeclaration`, `TSConstructSignatureDeclaration` | `Member` |
| `TSTypeAliasDeclaration`, `TSEnumDeclaration`, `TSEnumMember`, `TSModuleDeclaration`, `TSModuleBlock` | `StmtKind::{TypeAlias, Enum, Module}`, `EnumMember` |
| `TSParameterProperty` | `Param` with `is_parameter_property()` |
| `TSImportEqualsDeclaration`, `TSExternalModuleReference`, `TSExportAssignment`, `TSNamespaceExportDeclaration` | `StmtKind::{ImportEquals, ExportAssign, ExportAsNamespace}` |
| `Decorator` | `Modifier` with `.decorator()`. `class.decorators()`, `member.decorators()`, `param.modifiers()` |
| `:function` node ranges | `func.estree_span()` is the range of ESLint's node, whatever the kind of function. `func.params_span()`, `func.close_paren()`, `func.params_with_this()` |
| `ClassDeclaration` range | `class.estree_span()`. `class.keyword_span()`, `class.body_span()` |
| `source` of imports and exports | `stmt.module_specifier_span()`, `import.spec_span()`, `export.spec_span()` |
| `ImportAttribute` | `import.attributes()`, `export.attributes()`, `stmt.import_attributes()` → `ImportAttributes`: `entries()` (`Prop`s that are not nodes, their values are), `keyword_span()`, `braces_span()` |
| `JSXIdentifier`, `JSXMemberExpression`, `JSXNamespacedName` in a tag | `ExprKind::{Ident, This, Dot, String}` with `expr.is_jsx_tag_name()` |
| `JSXSpreadChild` | `ExprKind::Spread` among the children, with `jsx_container_span()` |
| `TSLiteralType` of a `` `a` `` without substitutions | `TypeKind::StringLit`, whose text starts with a backtick |
| `TSTemplateLiteralType` | `TypeKind::Template(types)`, `ty.as_template()` for `cooked(i)`, `raw(i)`, `quasi_span(i)` |
| `TSTypePredicate.parameterName` | `ty.predicate_param()` |
| `TSImportType` | `TypeKind::Import`. `ty.import_span()`, `ty.import_source_span()`, `ty.import_attributes()` |
| `TSInterfaceBody`, `TSEnumBody`, `TSModuleBlock` | Not nodes. `interface.body_span()`, `enum.body_span()`, `module.body_span()` |
| `TSExternalModuleReference` | `import_equals.require_span()` |
| the `constructor` key | `member.constructor_keyword()` (`member.key()` is `None` for a constructor) |
| parentheses | Never nodes. `expr.is_parenthesized()`, `expr.parens()`, `expr.outer_span()`, and for types `ty.is_parenthesized()`, `ty.outer_span()` |
| `node.parent` | `.parent()` → `Node`. `Func` and `Class` are levels of their own: a statement in a function body has the parent `Node::Func(f)`, whose parent is the `Expr`/`Stmt`/`Member`/`TypeNode` that owns it |
| `node.range`, `node.loc` | `.span()` (bytes). `file.position(offset)` for line and column |
| `sourceCode.getText(node)` | `.text()`, `file.slice(span)` |
| `context.report({ node, messageId, data, fix, suggest })` | `cx.report(node, MESSAGE).data(..).fix(..).suggest(..)` |
| `context.report({ loc: { start, end } })` | `cx.report(Span::new(start, end), MESSAGE)` |
| `context.report({ loc: position })` | `cx.report_at(offset, MESSAGE)` |
| `context.options` | `Options` in `Rule::new` |
| `context.languageOptions`, `context.settings`, `context.filename` | `file.language()`, `file.settings()`, `file.path()` |
| tokens and comments | table in `tokens/mod.rs` |
| scopes, variables, references | table in `semantic/mod.rs` |
| code paths | `code_path.rs`, `on.code_path_start(..)` etc. |
| `ast-utils.js`, `@eslint-community/eslint-utils`, typescript-eslint's `util/` | `bun_lint::utils`, same names in snake_case |

### Report locations must match ESLint's

The fixtures compare `line`, `column`, `endLine`, `endColumn`. `.span()` equals the ESTree range for most nodes. Known differences, which you must handle when upstream reports such a node:

- An exported declaration: see `ExportNamedDeclaration` above.
- A method's function: `func.span_from_params()`.
- `Identifier` with a type annotation (`a: T` in a declarator or a parameter): typescript-estree's range of the identifier includes `?` and the annotation. `pat.span()` does not: `param.binding_span()`, `var_decl.binding_span()`.
- A parameter: ESTree has no parameter node. `a = 1` is an `AssignmentPattern` (`param.span_without_modifiers()`), `...a` a `RestElement`, otherwise it is the pattern.
- JSDoc casts in `.js` (`/** @type {T} */ (e)`) are invisible: there is no `As` node, the parentheses belong to the operand.
- `on.exprs([Dot])` is also called with JSX tag names (`<a.b />`, `expr.is_jsx_tag_name()`) and with the operand of a `typeof a.b` type, which are not `MemberExpression`s for ESLint. Conversely `extends a.b` of an interface and `implements a.b` are `TypeKind::Ref` here and `MemberExpression`s there.
- `MemberKind::Constructor` also covers `static constructor() {}`, which ESLint calls a method.
- A `Member`'s span includes its `;`, like ESTree's `PropertyDefinition`, and for interface members the `,` or `;`, like `TSPropertySignature`.
- A `VariableDeclaration` in the head of a `for` has no `;`.

If the API lacks something you need (a position, a flag, a helper several rules want), do not work around it in the rule by re-scanning text in an ad-hoc way. Say so in your final report, naming the accessor you wanted, and write the rule as if it existed.

## Testing

```sh
/root/lint-refs/build.sh                       # dev build of bun-lint (release, lints as warnings)
B=/root/lint-target/release/bun-lint
$B conformance test/cli/lint/conformance/fixtures --rule=eqeqeq --verbose
$B conformance test/cli/lint/conformance/fixtures --report=/tmp/report
$B run eqeqeq file.js '["smart"]'
/root/lint-target/release/bun-sema hir file.ts --print   # the HIR of a file
```

Each fixture `fixtures/<plugin>/<rule>.json` has upstream's `meta` (messages, schema, default options) and, per case, `code`, `options`, `languageOptions`, and the `messages` and `output` that real ESLint produces.
