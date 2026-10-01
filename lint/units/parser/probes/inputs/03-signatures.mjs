// Group 03: parameters of function types, constructor types and signatures.
// Each parameter list goes into every owner of a signature.
import { template } from "./_lib.mjs";

const G = "src/js_parser/parse/parse_skip_typescript.rs";
const F = "src/js_parser/parse/parse_fn.rs";
const R = "parser.go";

export const families = {
  typeSig: {
    bun: `${G}:219-241 skip_type_script_paren_or_fn_type -> 1437 try_skip_type_script_arrow_args_with_backtracking -> 164-198 skip_typescript_fn_args -> 67-162 skip_type_script_binding (reduced grammar: no initializer, no modifier, no decorator; errors are swallowed by the backtracker)`,
    ref: `${R}:3825 parseFunctionOrConstructorType, 3309 parseParameters, 3364 parseParameterEx, 3412 parseNameOfParameter, 1634 parseIdentifierOrPattern, 1701 parseInitializer`,
  },
  memberSig: {
    bun: `${G}:898-906 (method and call signature in an object type) -> 164-198 skip_typescript_fn_args (not speculative: errors are reported)`,
    ref: `${R}:3249 parseSignatureMember, 3620 parsePropertyOrMethodSignature, 3309 parseParameters`,
  },
  declSig: {
    bun: `${F}:163-413 parse_fn (the full binding grammar, 213-345 the argument loop, 215-227 "this", 251-278 parameter properties, 281-303 "?" and ":")`,
    ref: `${R}:3309 parseParameters, 3364 parseParameterEx, 1715 parseFunctionDeclaration, 1999 parseMethodDeclaration, 1966 tryParseConstructorDeclaration`,
  },
  arrowSig: {
    bun: `src/js_parser/parse/mod.rs:418-660 parse_paren_expr (parameters are parsed as expressions, 470-475 skips ": T", 478-490 "=" after the type), 581-585 return type`,
    ref: `${R}:4390 parseParenthesizedArrowFunctionExpression, 4261 nextIsParenthesizedArrowFunctionExpression, 3309 parseParameters`,
  },
};

const params = [
  "", "a", "a?", "a: A", "a?: A", "a, b", "a: A, b: B", "a?: A, b?: B", "a?: A, b: B", "...a", "...a: A[]", "a: A, ...b: B[]", "...a: A[], b: B", "...a?: A[]", "...a = []", "...a: A[] = []", "a,", "a: A,", "...a,", "...a: A[],", ",", "a,,b", ", a",
  "a = 1", "a: A = 1", "a?: A = 1", "a? = 1", "a = 1, b = 2", "a = b", "a = () => 1", "a = {}", "a = (1, 2)", "a = b = c", "a: A = b as A", "a = <A>b", "a = b!", "a: (b: B) => C = d",
  "{ a }", "{ a }: A", "[a]", "[a]: A", "{ a, b }: A, [c, d]: B", "{ a: b }", "{ a = 1 }", "{ a = 1 }: A", "{ a: b = 1 }", "{ a: { b } }", "{ ...a }", "{ a, ...b }", "[, a]", "[...a]", "[a = 1]", "[a = 1]: A", "[{ a }]", "{ a: [b] }", "{ \"a\": b }", "{ 1: b }", "{ [k]: v }", "{ [k]: v = 1 }", "{ if: x }", "{ if }", "{ a, }", "[a, ]", "[a, , b]", "{}", "[]", "{}: A", "[]: A", "{ a } = {}", "[a] = []", "{ a }: A = {}", "{ a }?", "[a]?", "{ a }?: A", "...{ a }", "...[a]", "...[a, b]: A", "{ a b }", "{ a: }", "{ : a }", "[a b]", "{ a }: ", "{ 1n: a }", "{ a: b.c }", "[a.b]", "{ a() {} }", "{ get a() {} }", "{ ...{ a } }", "[...[a]]", "[...a, b]", "{ ...a, b }", "{ this: a }", "{ this }", "[this]", "{ a: this }", "{ a: A }", "{ a?: b }", "{ a!: b }", "[a?]", "[a: A]", "{ a = b as A }", "{ a: b = <A>c }", "{ await }", "{ yield }", "[await]", "{ a: await }", "{ let }", "{ static }", "{ type }", "{ as }", "{ of }", "{ async }", "{ arguments }", "{ eval }", "{ enum }", "{ public }", "{ implements }",
  "this", "this: A", "this: A, a: B", "this, a", "a, this: A", "this?: A", "...this: A", "this = 1", "this: A = 1", "this.a", "this: this", "this: typeof this",
  "a!", "a!: A", "a?!: A", "a: A!", "a:: A", "a:", "a?:", "a A", "a: A B", "a; b", "a: A; b: B", "(a)", "(a): A", "a.b", "a.b: A", "a[0]", "a()", "1", "\"a\"", "-a", "a + b", "a as A", "a satisfies A", "<A>a", "a<A>", "new a", "typeof a", "void a", "await a", "yield a", "...a.b", "...1", "a b", "...", "......a", "?", "a??", ": A", "= 1",
  "public a: A", "private a: A", "protected a: A", "readonly a: A", "override a: A", "public readonly a: A", "readonly public a: A", "private override readonly a: A", "static a: A", "declare a: A", "abstract a: A", "async a: A", "export a: A", "const a: A", "in a: A", "out a: A", "accessor a: A", "default a: A", "public a", "public a?", "public a?: A", "public a = 1", "public a: A = 1", "readonly a = 1", "public", "readonly", "private", "protected", "override", "public, private", "public: A", "public?: A", "readonly?: A", "public = 1", "readonly = 1", "public public", "public readonly", "readonly readonly", "public public a", "readonly readonly a", "public private a", "public this: A", "public ...a: A[]", "public { a }: A", "public [a]: A", "public { a }", "readonly { a }", "readonly [a]", "readonly ...a", "public\na: A", "readonly\na: A", "public a\n: A", "public static", "static", "static static", "public async", "declare", "abstract", "accessor", "async", "public a, private b, protected c, readonly d",
  "@d a", "@d a: A", "@d() a: A", "@d @e a: A", "@d public a: A", "public @d a: A", "@d readonly a: A", "@d ...a: A[]", "@d { a }: A", "@d [a]: A", "@d this: A", "@d a = 1", "@d a?: A", "@a.b.c a", "@a.b() a", "@(a) a", "@a<T>() a", "@d", "@ a", "@d\na: A", "a @d", "a: @d A",
  "yield", "await", "arguments", "eval", "static", "let", "type", "of", "async", "as", "satisfies", "is", "asserts", "infer", "keyof", "unique", "abstract", "out", "implements", "interface", "package", "enum", "if", "new", "class", "function", "in", "var", "const", "super", "import", "typeof", "delete", "default", "void", "null", "true", "any", "string", "undefined", "symbol", "object", "never", "unknown", "number", "boolean", "bigint", "module", "namespace", "declare", "global", "require", "get", "set", "constructor", "from", "using", "accessor", "override", "intrinsic", "defer",
  "yield: A", "await: A", "type: A", "of: A", "async: A", "as: A", "is: A", "asserts: A", "infer: A", "keyof: A", "unique: A", "abstract: A", "out: A", "any: A", "string: A", "undefined: A", "let: A", "static: A", "module: A", "namespace: A", "declare: A", "get: A", "set: A", "if: A", "new: A", "in: A", "typeof: A", "void: A", "null: A",
  "a: A | B", "a: () => void", "a: (b: B) => C", "a: new () => A", "a: { b: B }", "a: [B, C]", "a: typeof b", "a: keyof A", "a: A extends B ? C : D", "a: A[]", "a: A<B>", "a: A<B<C>>", "a: a is B", "a: asserts a", "a: this", "a: `x${A}`", "a: import(\"x\")", "a: -1", "a: unique symbol", "a: infer U", "a: ", "a: |", "a: ?A", "a: A?", "a: *",
];

const typeOwners = {
  fnType: P => `let x: (${P}) => void;`,
  ctorType: P => `let x: new (${P}) => A;`,
  abstractCtorType: P => `let x: abstract new (${P}) => A;`,
  genericFnType: P => `let x: <T>(${P}) => T;`,
  fnTypeInUnion: P => `let x: A | ((${P}) => void);`,
  fnTypeAsArg: P => `f<(${P}) => void>(x);`,
  fnTypeArrowRet: P => `const f = (): ((${P}) => void) => 0;`,
};

const memberOwners = {
  callSig: P => `type X = { (${P}): void };`,
  constructSig: P => `type X = { new (${P}): A };`,
  methodSig: P => `type X = { m(${P}): void };`,
  ifaceMethod: P => `interface I { m(${P}): void }`,
  ifaceCall: P => `interface I { <T>(${P}): T }`,
};

const declOwners = {
  fnDecl: P => `function f(${P}) {}`,
  fnExpr: P => `const f = function (${P}) {};`,
  declareFn: P => `declare function f(${P}): void;`,
  overload: P => `function f(${P}): void;\nfunction f(...a: any[]) {}`,
  method: P => `class C { m(${P}) {} }`,
  methodOverload: P => `class C { m(${P}): void; m(...a: any[]) {} }`,
  abstractMethod: P => `abstract class C { abstract m(${P}): void; }`,
  declareMethod: P => `declare class C { m(${P}): void; }`,
  ctor: P => `class C { constructor(${P}) {} }`,
  ctorOverload: P => `class C { constructor(${P}); constructor(...a: any[]) {} }`,
  declareCtor: P => `declare class C { constructor(${P}); }`,
  objMethod: P => `const o = { m(${P}) {} };`,
  setter: P => `class C { set p(${P}) {} }`,
  generator: P => `function* f(${P}) {}`,
  asyncFn: P => `async function f(${P}) {}`,
};

const arrowOwners = {
  arrow: P => `const f = (${P}) => 0;`,
  arrowRet: P => `const f = (${P}): void => {};`,
  asyncArrow: P => `const f = async (${P}) => 0;`,
  genericArrow: P => `const f = <T,>(${P}) => 0;`,
  arrowInCond: P => `const f = a ? (${P}) => 0 : 1;`,
  arrowInCondRet: P => `const f = a ? (${P}): void => {} : 1;`,
};

const cases = [];
for (const [ctx, make] of Object.entries(typeOwners)) cases.push(...template("typeSig", params, make, ctx));
for (const [ctx, make] of Object.entries(memberOwners)) cases.push(...template("memberSig", params, make, ctx));
for (const [ctx, make] of Object.entries(declOwners)) cases.push(...template("declSig", params, make, ctx));
for (const [ctx, make] of Object.entries(arrowOwners)) cases.push(...template("arrowSig", params, make, ctx));

export default { name: "function and constructor types with signature parameters", families, cases, programs: ["ts"], decoProgram: true };
