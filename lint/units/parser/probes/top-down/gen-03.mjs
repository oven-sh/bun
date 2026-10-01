#!/usr/bin/env bun
// Function and constructor types, and the parameters of every signature.
// Reference: parseFunctionOrConstructorType 3825, isStartOfFunctionTypeOrConstructorType 3818,
// nextIsUnambiguouslyStartOfFunctionType 3860, skipParameterStart 3885, parseParameters 3309, parseParameterEx 3364,
// parseNameOfParameter 3412, parseReturnType 3430, parseTypeOrTypePredicate 3452, parseModifiersForConstructorType 3845.
import { each, writeGroup } from "./gen-lib.mjs";

// One parameter list, without the parentheses.
export const parameterLists = [
  "", "a", "a: A", "a, b", "a: A, b: B", "a?", "a?: A", "a?, b?", "a?, b", "a??", "a?: A?", "...a", "...a: A[]", "a, ...b",
  "a: A, ...b: B[]", "...a, b", "...a,", "...a: A[],", "...a?", "...a?: A[]", "...a = []", "...a: A[] = []", "......a", "...",
  "a,", "a: A,", ",", ",a", "a,,b", "a b", "a: A b: B", "a;", "a: ", "a?: ", ": A", "a: A: B", "a = 1", "a: A = 1", "a?: A = 1",
  "a? = 1", "a = 1, b = 2", "a = b ? c : d", "a = (b, c)", "a = () => {}", "a = function () {}", "a = class {}", "a = <T>b",
  "a = b as T", "a = [1, 2]", "a = { b: 1 }", "a = await b", "a = yield", "a = b = c", "a = ", "a == 1",
  "{ a }", "{ a }: A", "{ a, b }: A", "{ a: b }: A", "{ a: { b } }: A", "{ a = 1 }: A", "{ a: b = 1 }: A", "{ ...a }: A",
  "{ a, ...b }: A", '{ "a": b }: A', "{ 1: b }: A", "{ [k]: b }: A", "{ [k]: b = 1 }: A", "{ a, }: A", "{ , }: A", "{}: A", "{}",
  "{ a }?: A", "{ a } = {}", "{ a }: A = {}", "{ a: b.c }: A", "{ a: 1 }", '{ "a" }', "{ 1 }", "{ if }", "{ if: a }", "{ a: if }",
  "{ ...{ a } }", "{ ...[a] }", "{ ...a, b }", "{ ...a = 1 }", "{ a b }", "{ a: }", "{ a",
  "[a]", "[a]: A", "[a, b]: A", "[, a]: A", "[a, , b]: A", "[...a]: A", "[a, ...b]: A", "[a = 1]: A", "[[a], { b }]: A", "[]: A",
  "[]", "[a]?: A", "[a] = []", "[a,]: A", "[...a, b]: A", "[...a,]: A", "[...[a]]: A", "[...{ a }]: A", "[a.b]: A", "[1]", "[a",
  "...[a, b]: A", "...{ a }: A", "...[a] = []",
  "this", "this: A", "this: A, b: B", "this, a", "a, this: A", "this?: A", "this?", "this = 1", "this: A = 1", "...this",
  "...this: A", "this.a", "this: A,", "{ this: a }", "[this]", "public this", "@d this", "this this",
  "@d a", "@d a: A", "@d() a: A", "@d @e a: A", "@d.e a", "@(d) a", "a @d", "@d ...a", "@d { a }", "@d public a: A", "public @d a: A",
  "@d", "@ a",
  ...each(
    ["public", "private", "protected", "readonly", "override", "static", "declare", "abstract", "async", "accessor", "export", "default", "const", "in", "out"],
    m => `${m} a: A`,
  ),
  ...each(
    ["public", "private", "protected", "readonly", "override", "static", "declare", "abstract", "async", "accessor", "export", "default", "const", "in", "out"],
    m => `${m}`,
  ),
  ...each(
    ["public", "private", "protected", "readonly", "override", "static", "declare", "abstract", "async", "accessor"],
    m => `${m}: A`,
  ),
  ...each(["public", "private", "readonly", "static", "async"], m => `${m}?: A`),
  ...each(["public", "private", "readonly", "static", "async"], m => `${m} = 1`),
  ...each(["public", "readonly", "static", "async"], m => `${m},b`),
  "public readonly a: A", "readonly public a: A", "public private a: A", "public public a: A", "readonly readonly a: A",
  "public override readonly a: A", "override public a: A", "public a", "public a?", "public a?: A", "public a = 1",
  "public a: A = 1", "public ...a: A[]", "public { a }: A", "public [a]: A", "public a!: A", "public\na: A", "public a, private b",
  "public static a", "public async", "readonly async a",
  ...each(
    ["string", "number", "any", "type", "of", "as", "is", "async", "await", "yield", "let", "keyof", "infer", "unique", "asserts", "arguments", "eval", "get", "set", "from", "global", "module", "namespace", "require", "undefined", "constructor", "implements", "interface", "package"],
    w => `${w}: A`,
  ),
  ...each(
    ["in", "class", "new", "function", "void", "null", "true", "typeof", "delete", "if", "var", "enum", "import", "export", "super", "with", "const", "default", "extends", "instanceof"],
    w => `${w}: A`,
  ),
  ...each(["in", "class", "new", "function", "void", "null", "typeof", "enum", "super"], w => `${w}`),
  "a!", "a!: A", "a: A!", "#a", "#a: A", "a.b", "a.b: A", "a[0]", "a()", '"a"', '"a": A', "1", "1: A", "`a`", "-a", "!a", "a | b",
  "a as A", "a is A", "a: b is A", "a: asserts b", "a extends A", "a: A extends B ? C : D", "a: A | B", "a: () => void",
  "a: (b: B) => C", "a: (b = 1) => C", "a: new () => A", "a: typeof b", "a: A<B>", "a: A<B<C>>", "a: A<B>=c", "a: A<B<C>>=d",
  "a: { b: B }", "a: [A, B]", "a: A[]", "a: this", "a: void", "a: unique symbol", "a: `t${A}`", "a: import('m').A",
];

export const returnTypes = [
  "void", "A", "A | B", "A & B", "A[]", "A extends B ? C : D", "keyof A", "typeof a", "() => void", "(a: A) => (b: B) => C",
  "new () => A", "{ a: A }", "{}", "[A]", "(A)", "(A | B)", "this", "a is A", "a is A | B", "this is A", "asserts a",
  "asserts a is A", "asserts this", "asserts this is A", "asserts", "asserts | A", "a is", "asserts a is", "is A", "a\nis A",
  "asserts\na", "unique symbol", "`t${A}`", "import('m')", "-1", "A<B>", "A<B<C>>", "infer A", "A?", "?A", "A!", "", ";", "=> A",
];

const fnTypes = [
  ...each(parameterLists, p => `(${p}) => R`),
  ...each(returnTypes, r => `(a: any) => ${r}`),
  ...each(returnTypes, r => `new (a: any) => ${r}`),
  "() =>", "() = > A", "() -> A", "(): A", "(a: A): B", "() => A => B", "()\n=> A", "() =>\nA", "(\n) => A", "(a: A)\n=> B",
  "(a) =>", "(a)\n=> A", "(a,\nb) => A", "() => () => () => A", "(() => A)", "((a: A) => B)[]", "(a: A) => B[]", "(a: A) => B | C",
  "((a: A) => B) | C", "(a: A) => B extends C ? D : E", "(a: A) => (B)", "((a)) => A", "((a: A)) => B", "(a)(b) => A",
  "<T>() => T", "<T>(a: T) => T", "<T,>() => T", "<T, U>() => T", "<T extends A>() => T", "<T = A>() => T", "<T extends A = B>() => T",
  "<const T>() => T", "<const T extends A>() => T", "<in T>() => T", "<out T>() => T", "<in out T>() => T", "<const in T>() => T",
  "<public T>() => T", "<>() => A", "<,>() => A", "<T U>() => A", "<T>", "<T>A", "<T>(a: T)", "<T>() =>", "<T>()", "<T>\n() => T",
  "<T>() =>\nT", "<\nT\n>() => T", "<T extends () => void>() => T", "<T extends (a: A) => B>() => T", "<T extends A<B>>() => T",
  "<T extends A<B<C>>>() => T", "<T = A<B>>() => T", "<T extends A<B> = C<D>>() => T", "<T>() => A<T>", "<T>() => A<B<T>>",
  "<T extends keyof U, U>() => T", "<T extends A extends B ? C : D>() => T", "<T extends infer U>() => T", "<T[]>() => A",
  "<T.U>() => A", '<"T">() => A', "<this>() => A", "<void>() => A", "<in>() => A", "<out>() => A", "<const>() => A",
  "<T extends>() => A", "<T =>() => A", "<T = >() => A", "<<T>() => T>() => A",
  "new () => A", "new (a: A) => B", "new <T>() => T", "new <T>(a: T) => A<T>", "new <const T>() => T", "new () => A | B",
  "new () => new () => A", "new () =>", "new ()", "new A", "new", "new (): A", "new () = > A", "new\n() => A", "new ()\n=> A",
  "new <>() => A", "new new () => A", "new (a) => A", "new (...a: A[]) => B", "new (public a: A) => B", "new (this: A) => B",
  "new.target", "new.A", "new A()", "new A.B", "new[]", "new | A",
  "abstract new () => A", "abstract new (a: A) => B", "abstract new <T>() => T", "abstract\nnew () => A", "abstract new\n() => A",
  "abstract", "abstract A", "abstract.A", "abstract<A>", "abstract[]", "abstract | A", "abstract new", "abstract new A",
  "abstract abstract new () => A", "new abstract () => A", "abstract () => A", "abstract <T>() => T", "abstract new () =>",
  "abstract new (): A", "(abstract new () => A)", "(abstract new () => A)[]", "abstract new () => A | B",
  "keyof abstract new () => A", "abstract keyof A", "abstract typeof a",
  ...each(["public", "private", "protected", "static", "readonly", "declare", "override", "async", "accessor"], m => `${m} new () => A`),
];

writeGroup("03-function-and-constructor-types.txt", "Function and constructor types with signature parameters.", [
  { prefix: "sig", kind: "atype", items: fnTypes },
  {
    prefix: "sigctx",
    kind: "type",
    items: [
      "() => void", "(a: A) => B", "(a) => B", "(a, b) => C", "(a?: A) => B", "(...a: A[]) => B", "(a = 1) => void", "(a: A = 1) => void",
      "({ a, b }: A) => B", "([a, b]: A) => B", "({ a = 1 }) => B", "([a = 1]) => B", "(this: A) => B", "(this) => B", "(a: ) => void",
      "(a?: ) => void", "(: A) => void", "(a,) => B", "(,) => B", "(a: A) => a is B", "(a: A) => asserts a", "<T>() => T",
      "<T>(a: T) => T", "<const T>(a: T) => T", "<in T>() => T", "<T extends A<B>>() => T", "new () => A", "new <T>(a: T) => A<T>",
      "abstract new () => A", "new (a = 1) => A", "(a: A) => (b: B) => C", "(a: A) => B | C", "(a: A) => B extends C ? D : E",
      "(public a: A) => B", "(@d a: A) => B", "(a?: A = 1) => B", "(...a?: A[]) => B", "(...a, b) => C", "(a?, b) => C",
    ],
  },
  {
    prefix: "decl",
    kind: "file",
    items: [
      ...each(parameterLists, p => `function f(${p}) {}`),
      ...each(returnTypes, r => `function f(a: any): ${r} {}`),
      ...each(parameterLists.slice(0, 120), p => `class C { m(${p}) {} }`),
      ...each(parameterLists.slice(0, 120), p => `class C { constructor(${p}) {} }`),
      ...each(parameterLists.slice(0, 120), p => `var v = { m(${p}) {} };`),
      ...each(parameterLists.slice(0, 120), p => `var v = function (${p}) {};`),
    ],
  },
]);
