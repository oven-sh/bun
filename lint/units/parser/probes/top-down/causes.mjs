// Names, for an input of class A1, A2 or B, the place in Bun's parser and the production of the reference parser.
// Bun paths are relative to src/js_parser in the worktree /workspace/wt/parser (commit e3566be889).
// "PST" is parse/parse_skip_typescript.rs. Reference lines are of /workspace/ref/typescript-go/internal/parser/parser.go.
//
// A row: { cls, group, rid, kind, ctx, src, type, msg, parse: [codes], grammar: [codes], other: [codes] }.
// SPECIFIC rules come first, in order. The first rule that matches names the cause. A row that no rule
// matches gets the cause of its AREA (the prefix of the record id) plus what Bun or tsc said.

const src = re => r => re.test(r.src);
const typ = re => r => r.type !== undefined && re.test(r.type);
const msg = re => r => re.test(r.msg);
const grammar = (...codes) => r => codes.some(c => r.grammar.includes(c));
const parse = (...codes) => r => codes.some(c => r.parse.includes(c));
const other = (...codes) => r => codes.some(c => r.other.includes(c));
const all = (...fs) => r => fs.every(f => f(r));
const any = (...fs) => r => fs.some(f => f(r));
const isA = r => r.cls === "A1" || r.cls === "A2";
const isB = r => r.cls === "B";

const RESERVED =
  "if|class|function|default|delete|in|instanceof|var|enum|export|extends|super|with|debugger|return|switch|case|break|continue|do|else|finally|for|throw|try|while|catch|const";

export const SPECIFIC = [
  {
    id: "jsdoc-type",
    when: all(isA, grammar(17019, 17020, 8020)),
    what: "JSDoc type syntax (?T, T?, !T, *, A.<B>, function(A): B): tsc parses it and the checker reports TS17019, TS17020 or TS8020",
    bun: "PST:259-671 (no arm for ?, ??, !, *, *=), PST:674-809 (no arm for a postfix ?), PST:730-734 ('.' must be followed by a name)",
    ref: "2812-2825 parseNonArrayType (*, ??, ?, !), 2771-2777 parsePostfixTypeOrHigher (postfix ?), 2959-2963 parseEntityName ('.<'), 2888-2922; function(A): B is parseJSDocFunctionType of tsc 6.0.2 and is NOT in parser.go",
  },
  {
    id: "tuple-member-question-or-rest-after-label",
    when: all(isA, other(5086, 5087)),
    what: "[a: A?], [a?: A?], [a: ...A[]]: tsc parses them and reports TS5086 / TS5087 (outside the grammar code ranges)",
    bun: "PST:618-624 (after the ':' of a label only a plain type is read)",
    ref: "3667-3681 parseTupleElementNameOrTupleElementType, 3694-3708 parseTupleElementType",
  },
  {
    id: "asserts-outside-return-type",
    when: all(isA, grammar(1228)),
    what: "asserts x / asserts x is T where no return type stands: tsc parses a predicate and the checker reports TS1228",
    bun: "PST:476-488 (asserts is a predicate only with SkipTypeOptions::IsReturnType)",
    ref: "2858-2862 parseNonArrayType, 3718-3732 parseAssertsTypePredicate",
  },
  {
    id: "unique-operand",
    when: all(isA, typ(/\bunique\b/), grammar(1005, 1335)),
    what: "unique with an operand other than symbol: tsc builds TypeOperator(unique, operand), the checker reports TS1005 'symbol' expected",
    bun: "PST:459-467 (unique is consumed only before symbol, the operand is then left over)",
    ref: "2721-2736 parseTypeOperatorOrHigher / parseTypeOperator",
  },
  {
    id: "type-name-is-out-or-in",
    twin: s => s.replace(/<(out|in)\b/, "<T"),
    when: all(isA, msg(/^The modifier "(out|in)" is not valid here/), r => r.grammar.length === 0),
    what: "a type parameter or a type NAMED out (function f<out>() {}, <out>x, <in>x): valid for tsc, Bun reads a variance modifier. The error is logged with self.log(), so it also leaks out of a backtracked attempt (H3)",
    bun: "PST:980-1047 (in / out are always modifiers; the error at 1038-1047 goes to self.log(), not to the lexer)",
    ref: "3277-3280 parseTypeParameter, 3968-3989 tryParseModifier, 4009-4034 nextTokenCanFollowModifier (a modifier only when a name can follow on the same line)",
  },
  {
    id: "type-parameter-modifier",
    when: all(isA, grammar(1273, 1274, 1277, 1029, 1030), any(src(/<[^>]*\b(in|out|const|public|private|protected|readonly|static|abstract|declare|override|async|accessor|export|default)\b/), msg(/modifier/))),
    what: "a modifier on a type parameter that the owner does not allow (in/out on a function, const on an interface or alias, public T, in in T, out in T): tsc parses every modifier, the checker reports TS1273, TS1274, TS1277, TS1029 or TS1030",
    bun: "PST:953-1053 skip_type_script_type_parameters (flags ALLOW_IN_OUT_VARIANCE_ANNOTATIONS / ALLOW_CONST_MODIFIER decide at parse time; other modifiers are not read at all)",
    ref: "3277-3307 parseTypeParameter, 3908-3946 parseModifiersEx(allowDecorators=false, permitConstAsModifier=true)",
  },
  {
    id: "type-parameter-list-empty",
    when: all(isA, grammar(1098)),
    what: "<> as a type parameter list: tsc parses it, the checker reports TS1098",
    bun: "PST:946-951 (an empty list only with ALLOW_EMPTY_TYPE_PARAMETERS: type alias and interface)",
    ref: "3270-3275 parseTypeParameters, 711 parseBracketedList",
  },
  {
    id: "type-argument-list-empty-or-trailing-comma",
    when: all(isA, grammar(1099, 1009), src(/<\s*>|,\s*>/)),
    what: "A<> and A<B,>: tsc parses them, the checker reports TS1099 / TS1009",
    bun: "PST:1200-1208 skip_type_script_type_arguments (a type is required after '<' and after each ',')",
    ref: "3063-3068 parseTypeArguments, 652-709 parseDelimitedList",
  },
  {
    id: "import-type-argument-not-a-string",
    when: all(isA, grammar(1141), src(/import\(/)),
    what: "import(A), import(`m`), import(\"m\" | \"n\"): tsc reads a type, the checker reports TS1141",
    bun: "PST:339-340 (expect(TOpenParen), expect(TStringLiteral))",
    ref: "3080-3081 parseImportType (parseType for the argument)",
  },
  {
    id: "import-type-arguments-without-qualifier",
    when: all(isA, src(/import\([^)]*\)\s*</)),
    what: "import(\"m\")<A>, typeof import(\"m\")<A>: type arguments right after the ')'",
    bun: "PST:327-356 (nothing is read after ')'; the suffix loop reads type arguments only after '.name', PST:730-748)",
    ref: "3109-3114 parseImportType (qualifier is optional, type arguments always)",
  },
  {
    id: "private-name-in-type",
    when: all(isA, src(/#[A-Za-z]/), msg(/#|identifier/)),
    what: "a private name where a type or a member name stands (typeof #p, import(\"m\").#a, { #a: A }, { get #a(): A }, A.#b, enum E { #a }): tsc parses it (TS18016, TS18024 or a type error)",
    bun: "PST:579-595 (typeof), PST:730-742 ('.' member), PST:826-832 (object type key), PST:651-669; parse_typescript.rs:576-781 (enum member)",
    ref: "3029-3034 parsePrivateIdentifier, 2996-3003 parseRightSideOfDot, 3503-3514 parsePropertyNameWorker",
  },
  {
    id: "reserved-word-as-type-name",
    twin: s => (/<(\w+)>x/.test(s) ? s.replace(/<(\w+)>x/, "<T>x") : null),
    when: all(isA, r => r.grammar.length === 0, any(msg(new RegExp(`^Unexpected "?(${RESERVED})"?$`)), all(src(/\bconst\s*</), msg(/^Expected/)), src(/\[function\]/))),
    what: "a reserved word as the name of a type reference (type X = if, if.A, if<A>, const<A>, <if>x, [...if: A[]], [function]): tsc takes any identifier name",
    bun: "PST:651-669 (the last arm takes only function, and only as a tuple label), PST:284-295 (const is consumed and nothing is read after it)",
    ref: "2865-2866 parseNonArrayType default, 2941-2967 parseTypeReference / parseEntityName(allowReservedWords=true); the name after '...' in a tuple: 3671-3672",
  },
  {
    id: "super-in-erased-position",
    when: all(isA, src(/\bsuper\b/), msg(/super/)),
    what: "super.a as A, super.a!, <A>super.x, namespace N { super.a }, interface I extends super.A: Bun reports super outside a method while parsing",
    bun: "parse_prefix.rs:22 pfx_t_super (error at parse time)",
    ref: "5268-5289 parseSuperExpression (no error in the parser for the place of super)",
  },
  {
    id: "contextual-keyword-as-declaration-name",
    twin: s => s.replace(/\b(as|satisfies)\b/, "$1_"),
    when: all(isA, src(/^(export |declare )?(type|interface|namespace|module|enum|class|declare namespace) (as|satisfies)\b/)),
    what: "as / satisfies as the name of a declaration (type as = 1, interface as {}, declare namespace as {}) (H15)",
    bun: "parse_stmt.rs:1706-1768 parse_stmt_fallthrough (the expression 'type' and its suffix 'as <type>' are parsed before the keyword is tested at 1742-1756), parse_suffix.rs:20-40",
    ref: "1113-1119 parseStatement, 6119-6196 isStartOfDeclaration / scanStartOfDeclaration (look ahead before any expression is parsed), 2142-2148, 2130-2132",
  },
  {
    id: "signature-parameter-initializer",
    twin: s => (/\((\w+)(: \w+)? = \w+\) =>/.test(s) ? s.replace(/\((\w+)(: \w+)? = \w+\) =>/g, "($1?: any) =>") : null),
    when: all(isA, any(other(2371, 2842), grammar(1015, 1048, 1212, 1213, 1186, 1308)), src(/=(?!>|=)/), r => /^(sig|sigctx|member|ta\.|angle|arrow\.params|decl|tp\.)/.test(r.rid) || /=>/.test(r.src)),
    what: "an initializer on a parameter of a signature, function type or overload ((a = 1) => void, { a(b = 1): void }, ({ a = 1 }) => R): tsc parses it (TS2371, or TS1015 / TS1048 with ? or ...)",
    bun: "PST:164-198 skip_typescript_fn_args (no '='), PST:67-162 skip_type_script_binding (no default in a pattern) (H4)",
    ref: "3364-3403 parseParameterEx (parseInitializer 1701), 1659-1700 parseArrayBindingElement / parseObjectBindingElement",
  },
  {
    id: "parameter-modifier-outside-constructor",
    twin: s => s.replace(/\b(public|private|protected|readonly|override) (?=[\w{\[.])/g, ""),
    when: all(isA, src(/\((@\w+\s+)?(public|private|protected|readonly|override|static|declare|abstract|accessor|async|export|in|out)\s+[\w{\[.]/), any(other(2369), grammar(1090, 1242, 1275, 1274, 1028, 1029, 1030, 1187, 1317))),
    what: "a modifier on a parameter that is not a parameter of a constructor implementation ((public a: A) => R, function f(public a) {}, (public a) => 1): tsc parses it (TS2369, or TS1090 and others)",
    bun: "PST:164-198 (signatures), parse_fn.rs:250-278 (only when opts.is_constructor), parse/mod.rs:418-660 parse_paren_expr (arrow parameters are expressions) (H13, H1)",
    ref: "3364-3403 parseParameterEx: 3372 parseModifiersEx(allowDecorators=true)",
  },
  {
    id: "parameter-decorator-outside-class-method",
    when: all(isA, src(/\(([^()]*,\s*)?@/), any(grammar(1206), msg(/Backtrack|identifier/))),
    what: "a decorator on a parameter of a function, arrow, signature or function type: tsc parses it, the checker reports TS1206. For a signature Bun prints the internal error name 'Backtrack'",
    bun: "parse_fn.rs:229-235 (opts.allow_ts_decorators), PST:169-176, PST:1322-1329 (Error::Backtrack reaches the log)",
    ref: "3364-3373 parseParameterEx (decorators are modifiers of every parameter)",
  },
  {
    id: "this-parameter-of-arrow",
    twin: s => (/\(this(: \w+)?(, ?|\))/.test(s) ? s.replace(/\(this(: \w+)?(, ?)?/, "(") : null),
    when: all(isA, msg(/Invalid binding pattern/), src(/\bthis\b/)),
    what: "a this parameter of an arrow function: tsc parses it (TS2730)",
    bun: "parse/mod.rs:418-660 parse_paren_expr (this is an expression, the conversion to a binding fails)",
    ref: "3374-3388 parseParameterEx (this parameter), 4390-4423",
  },
  {
    id: "rest-element-not-last",
    when: all(isA, msg(/after rest|rest element|rest argument|Invalid binding pattern/), any(other(2462), grammar(1013, 1014, 1048))),
    what: "something after a rest element or rest parameter ([...a, b], (...a, b), (...a,), (...a = [])): tsc parses it (TS2462, TS1013, TS1014, TS1048)",
    bun: "parse/mod.rs:997-1276 parse_binding, parse_fn.rs:331-341, parse/mod.rs:418-660",
    ref: "1648-1671 parseArrayBindingPattern / parseArrayBindingElement, 3331-3358 parseParametersWorker",
  },
  {
    id: "heritage-clause-expression",
    twin: s => (/^interface I extends /.test(s) ? "interface I {}" : /^class C (extends D )?implements /.test(s) ? s.replace(/ implements .*$/s, " {}") : null),
    when: all(isA, any(src(/^interface I extends /), src(/\bimplements /)), any(other(2499, 2500, 2422, 2312, 2507, 2508), r => r.grammar.length === 0)),
    what: "an expression in 'interface extends' or 'implements' (A(), new A, A`t`, (A)<B>, A?.B, class {}): tsc parses a left-hand-side expression with type arguments (TS2499 / TS2422 in the checker)",
    bun: "PST:1156-1177 (interface: every entry is read as a TYPE), parse/mod.rs:164-170 (implements: the same) (H8)",
    ref: "1835-1845 parseHeritageClause, 1852-1860 parseTypeHeritageClauseElement, 1884-1892 parseExpressionWithTypeArguments",
  },
  {
    id: "heritage-clause-list",
    when: all(isA, grammar(1097, 1172, 1173, 1174, 1175, 1176, 1009), any(src(/\bextends\b/), src(/\bimplements\b/))),
    what: "order, repetition or an empty list of heritage clauses: tsc parses, the checker reports TS1097, TS1172-TS1176, TS1009",
    bun: "PST:1156-1177, parse/mod.rs:150-170 (one extends, then one implements, each with at least one entry)",
    ref: "1824-1845 parseHeritageClauses (a list of clauses), 6350-6356 isHeritageClause",
  },
  {
    id: "modifier-before-declaration",
    when: all(isA, grammar(1042, 1044, 1242, 1024, 1040, 1031, 1030), src(/^(export |declare )?(async|abstract|static|public|private|protected|readonly|const|override|accessor|export|declare) /)),
    what: "a modifier that the declaration does not allow (abstract interface I {}, async enum E {}, static type X = A, export export const a): tsc parses modifiers before any declaration, the checker reports TS1042, TS1044, TS1242, TS1024 or TS1030",
    bun: "parse_stmt.rs:1706-1768 parse_stmt_fallthrough, 1830-1842 (abstract only before class), 825-1393 t_export",
    ref: "1124-1149 parseDeclaration (parseModifiersEx then parseDeclarationWorker), 6123-6196 scanStartOfDeclaration",
  },
  {
    id: "decorator-before-non-class",
    when: all(isA, src(/^@/), grammar(1206, 1203, 1184, 1314)),
    what: "a decorator before something that is not a class (@d interface I {}, @d enum E {}, @d export = A): tsc parses, the checker reports TS1206",
    bun: "parse_stmt.rs:78-131 t_at",
    ref: "1111-1112 parseStatement (KindAtToken -> parseDeclaration), 1124-1191",
  },
  {
    id: "namespace-in-statement-position",
    when: all(isA, grammar(1235, 1344)),
    what: "namespace or module inside a function or block: tsc parses, the checker reports TS1235",
    bun: "parse_stmt.rs:1794-1807 (opts.scope != StatementScope::Nested)",
    ref: "2202-2216 parseModuleDeclaration (no test of the place)",
  },
  {
    id: "declare-or-export-before-what-cannot-take-it",
    when: all(isA, grammar(1120, 1193, 1079, 1191, 1231, 1316, 1319, 1147, 1194, 1063, 1491, 1495, 1123, 1211, 1035, 1046, 1036, 1108, 1105)),
    what: "declare / export in front of a statement that cannot take it, module statements inside a namespace or block, and statements of an ambient context: tsc parses them, the checker names the rule",
    bun: "parse_stmt.rs:1855-1968 (declare: the statement after it must be S::TypeScript, S::Local or S::Empty), 825-1393 t_export, 1394-1673 t_import, parse_typescript.rs:205-481",
    ref: "1124-1191 parseDeclaration / parseDeclarationWorker, 2242-2252 parseModuleBlock (any statement), 2555-2626",
  },
  {
    id: "enum-member-name",
    when: all(isA, src(/\benum\b/), msg(/identifier/)),
    what: "an enum member whose name is a number, a bigint, a template, a computed name or a private name: tsc parses a property name (TS2452, TS1164, TS18024 in the checker)",
    bun: "parse_typescript.rs:576-781 parse_typescript_enum_stmt (identifier, keyword or string only)",
    ref: "2171-2179 parseEnumMember -> 3496-3514 parsePropertyName",
  },
  {
    id: "early-error-at-parse-time",
    when: all(isA, msg(/^(Class constructor cannot|Getter |Setter |Invalid (field|method) name|"[^"]+" (is a reserved word|can only be used|has already been declared)|Cannot use "|The keyword|A return statement|The constant|This constant|auto-accessor|Private name|TypeScript does not allow decorators on class constructors|Unexpected newline before|A rest argument|Optional chaining is not allowed in decorator|A decorator call expression)/)),
    what: "an early error that Bun reports while it parses and that tsc leaves to the checker or to a later check (or does not report): the parse of tsc is clean",
    bun: "the function that logs the message (parse_property.rs, parse_fn.rs, parse/mod.rs, parse_typescript.rs:77-203 for the decorator messages)",
    ref: "no parse diagnostic in parser.go for the same input; the checker (internal/checker grammarchecks) reports the code in column tsc_checker_grammar",
  },
  {
    id: "function-or-constructor-type-as-operand",
    when: all(isB, parse(1385, 1386, 1387, 1388)),
    what: "a function or constructor type as an operand of | or & without parentheses: tsc parses it and reports TS1385-TS1388 as a PARSE diagnostic",
    bun: "PST:676-717 (the operand is read by the same function, which takes '(' , '<' and new), PST:322-326 (leading operator)",
    ref: "3796-3816 parseFunctionOrConstructorTypeToError",
  },
  {
    id: "type-missing-accepted",
    when: all(isB, parse(1110)),
    what: "a place where a type must stand and nothing (or an operator) stands: (a: ) => void, (a): => a, f<A | >(x), A |, keyof, | | A, [A,,B]",
    bun: "PST:668 lexer.unexpected() logs and returns Ok (lexer.rs:303-326: it also returns Ok without a log when is_log_disabled, i.e. inside every backtracking attempt: PST:225, PST:1344-1355, PST:1331-1342, PST:1302-1320) (H3); PST:322-326 takes any run of leading | and &; PST:405-458 keyof / readonly / infer without an operand before ':', '?' or 'in'",
    ref: "2947 parseEntityNameOfTypeReference (diagnostics.Type_expected), 652-709 parseDelimitedList (isListElement 824), 6233-6254 isStartOfType",
  },
  {
    id: "import-type-attributes",
    when: all(isB, src(/import\(/), parse(1478, 1005, 1109, 1128, 1434, 1136, 1003, 2880)),
    what: "the second argument of an import type: Bun reads an object TYPE, tsc reads { with: { name: value } } (TS1478, TS1005 'with' expected, TS2880 for assert)",
    bun: "PST:344-353 (skip_type_script_object_type)",
    ref: "3083-3107 parseImportType, 3117-3158 parseImportAttribute / parseImportAttributes",
  },
  {
    id: "instantiation-expression-then-member",
    when: all(isB, parse(1477)),
    what: "a.b<c>.d and A<B>.C: tsc reports TS1477 as a parse diagnostic",
    bun: "parse_suffix.rs:871-904 and 962-995 (type arguments are skipped, the loop goes on with '.'), PST:730-748",
    ref: "5395-5440 parseMemberExpressionRest (Instantiation_expression_cannot_be_followed_by_a_property_access)",
  },
  {
    id: "lexer-level",
    when: all(isB, parse(1121, 1260, 1125, 1126, 1127, 1351, 1489, 6188, 6189)),
    what: "a token that tsc's scanner rejects: a legacy octal literal as a type, a keyword written with an escape, an invalid escape in a template type",
    bun: "lexer.rs (the tokens are accepted), PST:260-263, PST:386-388 (kind_for_identifier sees the decoded text), PST:636-649",
    ref: "scanner (internal/scanner), parser.go:5833-5855 parseLiteralExpression, 5890-5940 createIdentifierWithDiagnostic",
  },
  {
    id: "triple-slash-directive",
    when: all(isB, parse(1084)),
    what: "a malformed /// <reference ... /> directive: tsc reports TS1084 as a parse diagnostic; Bun reads a comment",
    bun: "lexer.rs (comments), no directive parser",
    ref: "6455-6567 getCommentPragmas / extractPragmas, parser.go:431-465 parseSourceFileWorker",
  },
];

// prefix of the record id -> [Bun site, reference production]
export const AREAS = [
  ["kw", "PST:276-283, 297-308, 489-538 (keyword arms), 730-748 ('.' after a keyword)", "2802-2811 parseNonArrayType (keyword followed by '.' is a type reference), 2870-2875"],
  ["lit", "PST:260-275, 309-321", "2826-2833, 2924-2939 parseLiteralTypeNode"],
  ["ref", "PST:386-560 (TIdentifier arm), 730-748, 1183-1230", "2941-3014 parseTypeReference, parseEntityName, parseRightSideOfDot, 3056-3068"],
  ["word", "PST:386-560, 651-669", "2941-3014"],
  ["query", "PST:561-601", "2842-2846, 3160-3170 parseTypeQuery"],
  ["import", "PST:327-356", "3075-3158 parseImportType"],
  ["tuple", "PST:602-631", "3662-3708 parseTupleType"],
  ["label", "PST:602-631 and the label tests at 284-295, 327-337, 357-368, 405-412, 561-570, 651-666 (H6)", "3667-3692 parseTupleElementNameOrTupleElementType, scanStartOfNamedTupleElement"],
  ["postfix", "PST:674-809 (718-729 '!', 749-763 '[')", "2763-2793 parsePostfixTypeOrHigher"],
  ["op", "PST:393-467", "2721-2761 parseTypeOperatorOrHigher, parseInferType, tryParseConstraintOfInferType"],
  ["set", "PST:322-326, 676-717", "2680-2719 parseUnionOrIntersectionType, 3796-3816"],
  ["cond", "PST:764-804, 434-458, 1302-1320, 1441-1478", "2655-2678 parseType, 2738-2761"],
  ["pred", "PST:297-308, 476-488, 549-554", "3452-3464 parseTypeOrTypePredicate, 3718-3732, 2883-2886"],
  ["tpl", "PST:636-649", "3734-3794 parseTemplateType"],
  ["paren", "PST:219-241, 1322-1329", "3710-3716 parseParenthesizedType, 3818-3823, 3860-3902"],
  ["broken", "PST:651-669", "2800-2868 parseNonArrayType"],
  ["m.", "parse/type_sink.rs:163-348 and PST as for the type form", "internal/transformers typeserializer (tsc: transformers/typeSerializer.ts)"],
  ["member", "PST:812-929 skip_type_script_object_type (H7); class members of group 06: parse_property.rs:241-802", "3222-3268 parseTypeMember, 3558-3645; class members: 1894-2056 parseClassElement"],
  ["mapped", "PST:812-929 (the same loop reads mapped types)", "3172-3220 nextIsStartOfMappedType, parseMappedType"],
  ["iface", "PST:1140-1181 skip_type_script_interface_stmt, parse_stmt.rs:1808-1829", "2130-2140 parseInterfaceDeclaration, 1824-1892"],
  ["alias", "PST:1085-1138 skip_type_script_type_stmt, parse_stmt.rs:1706-1768, 1783-1793", "2142-2165 parseTypeAliasDeclaration, 6123-6196 scanStartOfDeclaration"],
  ["sig", "PST:164-198 skip_typescript_fn_args, 67-162 skip_type_script_binding, 219-241", "3309-3428 parseParameters .. parseNameOfParameter, 3825-3843 parseFunctionOrConstructorType"],
  ["decl", "parse_fn.rs:213-345 (parameters), 371-400 (return type, missing body), parse/mod.rs:997-1276 parse_binding", "3309-3428, 3430-3464, 1715-1737 parseFunctionDeclaration"],
  ["tp.", "PST:933-1083 skip_type_script_type_parameters; callers parse_fn.rs:68, 457, parse/mod.rs:731, parse_prefix.rs:576, 639, 934, 965, parse_property.rs:626, PST:370, 377, 885, 1129, 1151", "3270-3307 parseTypeParameters / parseTypeParameter, 3908-3989"],
  ["ta.jsx", "parse_jsx.rs:28, PST:1183-1230", "4981-5014 parseJsxOpeningOrSelfClosingElementOrOpeningFragment, 5295-5321"],
  ["ta.", "PST:1183-1230 skip_type_script_type_arguments; callers parse_suffix.rs:194, 881, 972, parse_prefix.rs:696, parse/mod.rs:159, parse_typescript.rs:193, PST:558, 598, 746; typescript.rs:10-40", "3056-3068, 5295-5340 tryParseTypeArgumentsInExpression / canFollowTypeArgumentsInExpression, 1884-1892"],
  ["as", "parse_suffix.rs:20-40", "4638-4716 parseBinaryExpressionRest, makeAsExpression, makeSatisfiesExpression"],
  ["nonnull", "parse_suffix.rs:485-540 sfx_t_exclamation, parse/mod.rs:1307-1316 (definite assignment), parse_stmt.rs:430-434 (catch binding type)", "5395-5440 parseMemberExpressionRest, 1607-1632 parseVariableDeclarationWorker, 1496-1507 parseCatchClause"],
  ["angle", "parse_prefix.rs:892-992 pfx_t_less_than", "5185-5193 parseTypeAssertion, 5113-5141 parseSimpleUnaryExpression, 4244-4367"],
  ["garrow", "parse_prefix.rs:892-992, parse/mod.rs:1588-1739 (async), typescript.rs:44-72 is_ts_arrow_fn_jsx", "4244-4486 isParenthesizedArrowFunctionExpression .. parseParenthesizedArrowFunctionExpression"],
  ["arrow", "parse/mod.rs:418-660 parse_paren_expr (474 parameter type, 581-585 return type), parse_fn.rs:520-610 parse_arrow_body, PST:1344-1417 (H1, H5)", "4244-4538, 4601-4622 parseConditionalExpressionRest"],
  ["inst", "parse_suffix.rs:871-904 sfx_t_less_than, 962-995 sfx_t_less_than_less_than, PST:1331-1342, typescript.rs:10-40", "5295-5340, 5395-5440, 5501-5536 parseCallExpressionRest"],
  ["modifier", "parse_property.rs:334-500 (H12)", "1894-1947 parseClassElement, 3908-3989, 4009-4095"],
  ["extends", "parse/mod.rs:136-290 parse_class (159 type arguments after the extends expression, 164-170 implements), parse_prefix.rs:541-666", "1747-1795 parseClassDeclarationOrExpression, 1824-1892"],
  ["implements", "parse/mod.rs:164-170 (every entry is read as a type) (H8)", "1835-1860, 1884-1892"],
  ["class", "parse/mod.rs:675-770 parse_class_stmt, parse_stmt.rs:1830-1842 (abstract), 132-164 t_class", "1739-1814"],
  ["this", "parse_fn.rs:214-227", "3374-3388 parseParameterEx"],
  ["overload", "parse_fn.rs:19-161 parse_fn_stmt (106-124), 396-400; parse_property.rs:112 (H10)", "3530-3542 parseFunctionBlockOrSemicolon, 1715-1737"],
  ["export", "parse_stmt.rs:825-1393 t_export (864 export import, 892 export as namespace, 923-944 export type, 1373 export =), parse_import_export.rs:291-472, PST:1085-1120", "1173-1183, 2555-2651 parseExportAssignment .. parseExportSpecifier"],
  ["declare", "parse_stmt.rs:1855-1968 (TsStmtDeclare), 1794-1807, 1843-1854 (global) (H9, H18)", "1124-1191 parseDeclaration, 2202-2240 parseModuleDeclaration / parseAmbientExternalModuleDeclaration"],
  ["namespace", "parse_typescript.rs:205-481 parse_type_script_namespace_stmt, parse_stmt.rs:1794-1807", "2202-2277"],
  ["enum", "parse_typescript.rs:576-781 parse_typescript_enum_stmt, parse_stmt.rs:64-77 t_enum", "2171-2200 parseEnumMember / parseEnumDeclaration"],
  ["position", "parse_stmt.rs:78-131 t_at, parse_typescript.rs:35-203, parse_property.rs:241-802, parse_fn.rs:229-235", "3908-3966 parseModifiersEx, parseDecorator, parseDecoratorExpression"],
  ["expr.", "parse_typescript.rs:35-203 (77-203 parse_standard_decorator without experimentalDecorators)", "3948-3966 parseDecorator / parseDecoratorExpression (parseLeftHandSideExpressionOrHigher)"],
  ["meta", "parse_fn.rs:288-303, 371-393, parse_property.rs:626-673, parse/type_sink.rs:163-348", "tsc transformers/typeSerializer.ts"],
  ["dts", "parse_entry.rs (there is no ambient mode: a .d.ts file is parsed like a .ts file)", "431-465 parseSourceFileWorker (declaration file: NodeFlagsAmbient), 3530-3542"],
  ["pragma", "lexer.rs (comments)", "6455-6567 getCommentPragmas / extractPragmas"],
];
AREAS.push(["import", "parse_stmt.rs:1394-1673 t_import (1548-1606 import type), parse_import_export.rs:116-290, parse_typescript.rs:482-575 (H14)", "2279-2553 parseImportDeclarationOrImportEqualsDeclaration .. tryParseImportAttributes"]);

function areaOf(row) {
  const rid = row.rid;
  if (row.group.startsWith("07") && rid.startsWith("import")) return AREAS[AREAS.length - 1];
  if (row.group.startsWith("06") && rid.startsWith("member")) {
    return ["member", "parse_property.rs:241-802 parse_property (292-318 index signature, 334-500 modifiers, 600-680 '?', '!', type parameters, type) (H12)", "1894-2056 parseClassElement .. parsePropertyDeclaration, 3476-3494 parseAccessorDeclaration"];
  }
  let best = null;
  for (const area of AREAS) {
    if (rid.startsWith(area[0]) && (best === null || area[0].length > best[0].length)) best = area;
  }
  return best ?? ["?", "?", "?"];
}

const normalize = s =>
  s
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .replace(/^Unexpected \S+$/, "Unexpected …");

export function causeOf(row) {
  for (const rule of SPECIFIC) {
    if (rule.when(row)) return { id: rule.id, what: rule.what, bun: rule.bun, ref: rule.ref, twin: rule.twin ?? null };
  }
  const area = areaOf(row);
  const said =
    row.cls === "B"
      ? `tsc TS${row.parse[0]} ${normalize(row.parseFirstMessage)}`
      : `bun ${normalize(row.msg)}${row.grammar.length > 0 ? `; tsc checker ${row.grammar.map(c => `TS${c}`).join(" ")}` : ""}`;
  return { id: `${area[0].replace(/\.$/, "")}: ${said}`, what: "", bun: area[1], ref: area[2], twin: null };
}
