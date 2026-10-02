// The family of a row: the cause of round 2 that owns it, under a short name, with what this research found of the site in main
// (f4d755a9cf) that decides the row. `site` is where main's parse leaves what tsc reads. `route` says which kind of place a lint
// parse can branch at without a cost to a parse without lint:
//   grammar     inside the type grammar: the lint grammar reads it, the site only has to call it
//   ts-token    a test of the side-table option after a token test that only TypeScript syntax passes
//   error-path  a test of the side-table option where main logs its error: no program that main accepts runs it
//   none-found  the decision needs state from a place that JavaScript reaches: no such place was found by this research
import { ts, parse } from "./roots.mjs";
const K = ts.SyntaxKind;
export const FAMILIES = {
  "reserved-type-name": { cause: "a reserved word is the name of a type reference", route: "grammar", site: "parse_skip_typescript.rs:239 skip_type_script_type_with_opts, the arm of no type: Lexer::unexpected" },
  "reserved-tuple-label": { cause: "a reserved word is the label of a rest element of a tuple", route: "grammar", site: "parse_skip_typescript.rs:239 skip_type_script_type_with_opts, the tuple arm (H6)" },
  "import-type": { cause: "an import type takes type arguments and an expression in an attribute; .< stands before type arguments", route: "grammar", site: "parse_skip_typescript.rs:239 skip_type_script_type_with_opts, the import arm; :1024 skip_type_script_object_type for the attributes" },
  "asserts-is-next-line": { cause: "the type of an assertion predicate starts on the next line", route: "grammar", site: "parse_skip_typescript.rs:20 skip_typescript_return_type and the asserts arm of :239" },
  "signature-initializer": { cause: "a parameter of a signature has an initializer", route: "grammar", site: "parse_skip_typescript.rs:60 skip_type_script_binding, :157 skip_typescript_fn_args, :1024 skip_type_script_object_type (H4, H7)" },
  "signature-pattern": { cause: "a binding pattern of a signature is read as a binding pattern", route: "grammar", site: "parse_skip_typescript.rs:60 skip_type_script_binding" },
  "signature-parameter-modifier": { cause: "a modifier stands before a parameter that is no parameter property", route: "grammar", site: "parse_skip_typescript.rs:157 skip_typescript_fn_args, :1024 skip_type_script_object_type" },
  "out-in-name": { cause: "out or in names a type or a type parameter", route: "grammar", site: "parse_skip_typescript.rs:1145 skip_type_script_type_parameters logs `The modifier \"out\" is not valid here` through the log, also inside an attempt that goes back (H3)" },
  "as-less-equals": { cause: "a comparison follows the type after as and satisfies", route: "grammar", site: "parse_skip_typescript.rs:1395 skip_type_script_type_arguments takes T::TLessThanEquals for the start of type arguments" },
  "interface-extends-expression": { cause: "an interface extends, or a class implements, an expression", route: "grammar", site: "parse_skip_typescript.rs:1352 skip_type_script_interface_stmt reads each entry with skip_type_script_type (H8)" },
  "class-implements-expression": { cause: "an interface extends, or a class implements, an expression", route: "ts-token", site: "parse/mod.rs:163 parse_class, `if Self::IS_TYPESCRIPT_ENABLED { if p.lexer.is_contextual_keyword(b\"implements\")`: each entry is skip_type_script_type (H8)" },
  "function-parameter-modifier": { cause: "a modifier stands before a parameter that is no parameter property", route: "error-path", site: "parse_fn.rs:251 `if is_identifier && opts.is_constructor`: every parameter of a TypeScript file passes it. main fails later at parse_fn.rs:365 `p.lexer.expect(T::TCloseParen)`, after it declared the modifier as a parameter" },
  "rest-parameter-comma": { cause: "a comma follows the rest parameter of a signature of a declared class", route: "error-path", site: "parse_fn.rs:331 `if func.flags.contains(Flags::Function::HasRestArg)`: the else of `opts.is_typescript_declare` is `p.lexer.expect(T::TCloseParen)` (parse_fn.rs:337) at a comma, which always fails" },
  "index-signature-comma": { cause: "a comma ends an index signature of a class", route: "ts-token", site: "parse_property.rs:301 `if p.lexer.token == T::TColon && was_identifier && opts.is_class` inside `if Self::IS_TYPESCRIPT_ENABLED`, then expect_or_insert_semicolon at :309" },
  "accessor-modifier": { cause: "accessor is a modifier without standard decorators", route: "error-path", site: "parse_property.rs:464 PropertyModifierKeyword::PAccessor asks `p.options.features.standard_decorators` (:468): without it main reads a property named accessor and fails at the name after it" },
  "as-names-declaration": { cause: "as or satisfies names a type alias, an interface or a namespace", route: "error-path", site: "parse_stmt.rs:1706 parse_stmt_fallthrough reads the expression first, so parse_suffix.rs:23 sfx_handle_typescript_as reads a cast of the keyword: `type as = 1` fails in the type after as, `interface as {}` is the cast and the arm TsStmtInterface (parse_stmt.rs:1808) then finds no name. The keyword arms of parse_stmt.rs:1776 parse_stmt_fallthrough_ts_keyword and the Err of parse_expr_or_let_stmt (parse_stmt.rs:1728) are free places; both have to put the lexer back to the token after the keyword" },
  "cast-after-as-declaration": { cause: "ruling: cast after a declaration named as", route: "error-path", site: "the same site. tsc rejects the second statement; a lint parse rejects it today (parse_stmt.rs test a_lint_parse_reads_no_cast_where_the_reference_reads_a_declaration)" },
  "abstract-declare": { cause: "abstract stands before declare", route: "ts-token", site: "parse_stmt.rs:1830 the arm TsStmtAbstract of parse_stmt_fallthrough_ts_keyword takes only T::TClass (or decorators) after abstract" },
  "enum-member-in-brackets": { cause: "a string in brackets names an enum member", route: "error-path", site: "parse_typescript.rs:635 parse_typescript_enum_stmt: a name that is no string and no identifier is `p.lexer.expect(T::TIdentifier)`" },
  "namespace-import-expression": { cause: "import starts an expression in a namespace", route: "error-path", site: "parse_stmt.rs:1410 t_import: `(opts.is_export || (opts.scope.is_namespace() && !opts.is_typescript_declare)) && token != T::TIdentifier` is `p.lexer.expected(T::TIdentifier)` (:1413)" },
  "import-attributes-next-line": { cause: "the attributes of an import start on the next line", route: "none-found", site: "parse/mod.rs:1356 parse_path `if !p.lexer.has_newline_before && (assert || with)`: JavaScript reaches it for every module path, and a line break is the common case. main then reads a with statement and fails at `{`: that error (parse_stmt.rs:307 t_with, `expect(T::TOpenParen)`) is the one free place, with the import statement already made" },
  "type-import-attributes-next-line": { cause: "ruling: attributes of a type-only import on the next line", route: "none-found", site: "the same site. tsc parses it and its checker reports TS2857" },
  "export-attributes-next-line": { cause: "ruling: attributes of an export on the next line", route: "grammar", site: "the same site. tsc rejects it as main does: both read a with statement, TS1005 `'(' expected.` at the `{`" },
  "colon-after-operand": { cause: "a colon follows an operand that ends with a parenthesis", route: "error-path", site: "parse/mod.rs:513 parse_paren_expr: `is_arrow_fn || opts.force_arrow_fn || (Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon)` then `if level.gt(Level::Assign) { p.lexer.unexpected()?; ...` (:518)" },
  "conditional-colon": { cause: "a colon follows parentheses between ? and : of a conditional", route: "ts-token", site: "parse_prefix.rs:965 pfx_t_less_than and parse/mod.rs:1703 parse_async_prefix_expr (T::TLessThan) call parse_paren_expr with ParenExprOpts::default(): `flags == EFlags::AfterQuestionAndBeforeColon` is in hand there and is dropped, so parse/mod.rs:570 takes the cheap check" },
  "conditional-colon-in-arrow-body": { cause: "a colon follows parentheses between ? and : of a conditional", route: "none-found", site: "parse_fn.rs:520 parse_arrow_body reads the body with EFlags::None: the body of an arrow function in the true branch does not know of the `?`. JavaScript reaches parse_arrow_body and parse_suffix.rs:404 sfx_t_question. main fails at parse_suffix.rs:466 `p.lexer.expect(T::TColon)`, after the inner arrow function took the colon: that error is a free place for a parse that starts again with the offset of the colon as a hint" },
};
const METADATA = {
  "metadata: | and & operands are the check type of a conditional type": "metadata-union-check-type",
  "metadata: keyof, readonly and unique end before extends": "metadata-operator-before-extends",
  "metadata: the type after the colon of a conditional type takes | and &": "metadata-false-type-union",
  "metadata: a keyword before a dot is the first name of a type reference": "metadata-keyword-dot",
  "metadata: unique takes the whole type after it": "metadata-unique-operand",
  "metadata: the branches of a conditional type merge as the operands of | do": "metadata-conditional-branches",
  "metadata: an operand of | and & counts as what it serializes to": "metadata-operand-serialization",
  "metadata: an import type and unique symbol are Object": "metadata-import-and-unique",
  "metadata: a type predicate is Boolean, an assertion predicate is undefined": "metadata-predicates",
};
for (const [cause, id] of Object.entries(METADATA)) FAMILIES[id] = { cause, route: "grammar", site: "the type grammar and TypeSink::DecoratorMetadata (parse/type_sink.rs of 2d28b35c01): the value follows the tree that the skipper read" };

// True where the parentheses before the colon are in the body of an arrow function of the true branch.
function inArrowBody(src, loader) {
  const sf = parse(src, loader);
  let found = null;
  const visit = n => {
    if (n.kind === K.ConditionalExpression && found === null) {
      let t = n.whenTrue;
      found = false;
      for (;;) {
        if (t.kind === K.ConditionalExpression) t = t.whenFalse;
        else if (t.kind === K.ArrowFunction && t.body.kind !== K.Block) { found = true; t = t.body; }
        else break;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found === true;
}
export function familyOf(r) {
  const c = r.cause;
  if (METADATA[c]) return METADATA[c];
  if (r.loader === "js") return /^export/.test(r.src) ? "export-attributes-next-line" : "import-attributes-next-line";
  if (c.startsWith("ruling: A>A a declaration named as")) return "as-names-declaration";
  if (c === "a modifier stands before a parameter that is no parameter property") return r.class === "T" ? "signature-parameter-modifier" : "function-parameter-modifier";
  if (c === "an interface extends, or a class implements, an expression") return r.class === "T" ? "interface-extends-expression" : "class-implements-expression";
  if (c === "a colon follows parentheses between ? and : of a conditional") return inArrowBody(r.src, r.loader) ? "conditional-colon-in-arrow-body" : "conditional-colon";
  for (const [id, f] of Object.entries(FAMILIES)) if (f.cause === c) return id;
  throw new Error("no family for " + c);
}
