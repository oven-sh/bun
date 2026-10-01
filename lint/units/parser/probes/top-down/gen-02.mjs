#!/usr/bin/env bun
// Object types, interfaces, type aliases, mapped types.
// Reference: parseTypeMember 3222, parseSignatureMember 3249, isIndexSignature 3558, parsePropertyOrMethodSignature 3620,
// parseMappedType 3183, nextIsStartOfMappedType 3172, parseInterfaceDeclaration 2130, parseTypeAliasDeclaration 2142,
// parseHeritageClause 1835, parseTypeHeritageClauseElement 1852.
import { each, writeGroup } from "./gen-lib.mjs";

const members = [
  "{}", "{ a: A }", "{ a?: A }", "{ a }", "{ a? }", "{ a, b }", "{ a; b }", "{ a\nb }", "{ a: A, b: B }", "{ a: A; b: B }",
  "{ a: A\nb: B }", "{ a: A b: B }", "{ a: A, b: B, }", "{ a: A; b: B; }", "{ a: A;; }", "{ a: A,, }", "{ , }", "{ ; }",
  "{ a: }", "{ a?: }", "{ : A }", "{ a: A = 1 }", "{ a = 1 }", "{ a?: A = 1 }", "{ a!: A }", "{ a! }", "{ a?!: A }",
  "{ readonly a: A }", "{ readonly a?: A }", "{ readonly: A }", "{ readonly?: A }", "{ readonly }", "{ readonly readonly: A }",
  "{ readonly readonly a: A }", "{ readonly\na: A }", "{ readonly a(): void }", "{ readonly (): void }",
  '{ "a": A }', "{ 'a'?: A }", "{ 1: A }", "{ 1.5: A }", "{ 0x10: A }", "{ 1n: A }", "{ -1: A }", "{ `a`: A }",
  "{ #a: A }", "{ [a]: A }", "{ [a]?: A }", "{ [a.b]: A }", "{ [Symbol.iterator]: A }", '{ ["a"]: A }', '{ ["a" + "b"]: A }',
  "{ [a, b]: A }", "{ [a](): A }", "{ [a]?(): A }", "{ [a]<T>(): A }", "{ []: A }", "{ [1]: A }", "{ [a as B]: A }",
  "{ a(): void }", "{ a(b: B): void }", "{ a?(): void }", "{ a<T>(b: T): T }", "{ a(); }", "{ a(), b() }", "{ a() {} }",
  "{ a(): void {} }", "{ a(b = 1): void }", "{ a(public b: B): void }", "{ a(this: A): void }", "{ a(...b: B[]): void }",
  "{ a(): b is B }", "{ a(b): asserts b }", "{ a(): this is B }", "{ a() => void }", "{ a: () => void }", "{ a?: () => void }",
  '{ "a"(): void }', "{ 1(): void }", "{ async a(): void }", "{ *a(): void }", "{ async *a(): void }",
  "{ (): void }", "{ (a: A): B }", "{ <T>(a: T): T }", "{ (): void; (a: A): B }", "{ () }", "{ (a) }", "{ (): }",
  "{ ()?: void }", "{ (): void, }", "{ () => void }", "{ readonly (): void }",
  "{ new (): A }", "{ new (a: A): B }", "{ new <T>(a: T): A }", "{ new () }", "{ new (): }", "{ new: A }", "{ new?: A }",
  "{ new }", "{ new(): A; new: B }", "{ new?(): A }", '{ "new"(): A }', "{ new\n(): A }", "{ new new (): A }",
  "{ new () => A }", "{ abstract new (): A }", "{ readonly new (): A }", "{ new<T>(): A }",
  "{ [k: string]: A }", "{ [k: number]: A }", "{ [k: symbol]: A }", "{ [k: string | number]: A }", "{ [k: `a${string}`]: A }",
  "{ [k: K]: A }", "{ readonly [k: string]: A }", "{ static [k: string]: A }", "{ public [k: string]: A }",
  "{ [k: string]?: A }", "{ [k?: string]: A }", "{ [...k: string[]]: A }", "{ [k: string, l: number]: A }",
  "{ [k: string,]: A }", "{ [k, l]: A }", "{ [k?]: A }", "{ [k: string] }", "{ [k: string]: }", "{ [k: string]: A = 1 }",
  "{ [k: string](): A }", "{ [public k: string]: A }", "{ [k: string]: A; [l: number]: B }", "{ [k: string]: A, a: B }",
  "{ [this: string]: A }", "{ [k = 1]: A }", "{ [{ k }: string]: A }", "{ [k: string\n]: A }", "{ -readonly [k: string]: A }",
  "{ get a(): A }", "{ set a(v: A) }", "{ get a(): A; set a(v: A) }", "{ get a() }", "{ get a }", "{ get: A }", "{ get?: A }",
  "{ get }", "{ get(): A }", "{ get<T>(): A }", "{ set: A }", "{ set(v: A): void }", "{ get\na(): A }", "{ set\na(v) }",
  "{ get a<T>(): A }", "{ set a(v: A): void }", "{ get a(v): A }", "{ set a() }", "{ get a(): A {} }", '{ get "a"(): A }',
  "{ get 1(): A }", "{ get [a](): A }", "{ get #a(): A }", "{ readonly get a(): A }", "{ get readonly a(): A }",
  "{ get get(): A }", "{ get set(): A }", "{ get new(): A }", "{ set a(v?: A) }", "{ set a(...v: A[]) }", "{ get a?(): A }",
  ...each(
    ["public", "private", "protected", "static", "abstract", "declare", "override", "async", "accessor", "export", "default", "const", "in", "out"],
    m => `{ ${m} a: A }`,
  ),
  ...each(
    ["public", "private", "protected", "static", "abstract", "declare", "override", "async", "accessor", "export", "default", "const", "in", "out", "type", "of", "as", "is", "if", "class", "function", "void", "null", "this", "true", "typeof", "delete", "import", "enum", "var", "let", "yield", "await", "keyof", "infer", "unique", "any", "string", "constructor"],
    m => `{ ${m}: A; ${m}?: A; ${m}(): A }`,
  ),
  "{ static readonly a: A }", "{ readonly static a: A }", "{ public readonly a: A }", "{ @d a: A }", "{ ...A }", "{ a: A, ...B }",
  "{ a.b: A }", "{ a | b: A }", "{ a: A }[]", '{ a: A }["a"]', "{ a: A } | { b: B }", "{ a: { b: { c: C } } }",
  "{ a: A extends B ? C : D }", "{ a: A | B; b: C & D }", "{ a: typeof b }", "{ a: A<B>; c: D<E<F>> }", "{ a: A<B>, c: D }",
  "{ a: [A, B]; c: C[] }", "{ a: keyof A }", "{ a: new () => A }", "{ a: `t${A}` }", "{ a: -1 }", "{ a: import('m').A }",
  "{\n  a: A\n  b: B\n  c(): C\n  (): D\n  new (): E\n  [k: string]: F\n}", "{ a: A\n<T>(b: T): T }", "{ a: A.B\n<T>(b: T): T }",
  "{ a: A\n[k: string]: B }", "{ a: A\n(b: B): C }", "{ a\n(b: B): C }", "{ a: A\nextends: B }", "{ a: A\n?: B }", "{ a: typeof b\n<T>(c: T): T }",
  "{ a: A", "{ a: A ]", "{ a: A )",
];

const mapped = [
  "{ [K in A]: B }", "{ [K in keyof A]: A[K] }", "{ [K in A]?: B }", "{ [K in A]+?: B }", "{ [K in A]-?: B }",
  "{ readonly [K in A]: B }", "{ +readonly [K in A]: B }", "{ -readonly [K in A]: B }", "{ -readonly [K in A]-?: B }",
  "{ +readonly [K in A]+?: B }", "{ [K in A as C]: B }", "{ [K in keyof A as `get${K}`]: A[K] }",
  "{ [K in A as K extends B ? C : never]: D }", "{ [K in A]: B; }", "{ [K in A]: B, }", "{ [K in A] }", "{ [K in A]; }",
  "{ [K in A]? }", "{ [K in A]: }", "{ [K in A]?: }", "{ [K in A]: B; c: C }", "{ [K in A]: B; [L in C]: D }",
  "{ a: A; [K in B]: C }", "{ [K in A]: B\n}", "{\n  [K in A]: B\n}", "{ +[K in A]: B }", "{ -[K in A]: B }",
  "{ readonly +[K in A]: B }", "{ readonly readonly [K in A]: B }", "{ + readonly [K in A]: B }", "{ [K in A]+: B }",
  "{ [K in A]-: B }", "{ [K in A]!: B }", "{ [K in A]??: B }", "{ [K in A]?+: B }", "{ [K in A] +?: B }",
  "{ [K in A as]: B }", "{ [K in]: B }", "{ [K in A,]: B }", "{ [K, L in A]: B }", "{ [K in A in B]: C }",
  "{ [in in A]: B }", "{ [K of A]: B }", "{ [K extends A]: B }", "{ [K in A extends B ? C : D]: E }",
  "{ [K in A | B]: C }", "{ [K in (A)]: B }", "{ [K in A as B as C]: D }", "{ [K in A]: B }[]", "{ [K in A]: B }[K]",
  "{ [K in A]: B }[keyof A]", "{ [K in A]: B } & C", "{ [K in A]: { [L in B]: C } }", "{ [K in A]: () => void }",
  "{ [K in A]: B extends C ? D : E }", "{ [K in A]\n: B }", "{ [\nK in A\n]: B }", "{ [K\nin A]: B }", "{ static [K in A]: B }",
  "{ public [K in A]: B }", "{ [K in A](): B }", "{ [K in A]<T>(): B }", "{ [K in A] = B }", "{ [K in A]: B = 1 }",
  "{ [K.L in A]: B }", '{ ["K" in A]: B }', "{ [1 in A]: B }", "{ [#K in A]: B }", "{ [K in A]: B", "{ [K in A: B }",
  ...each(
    ["keyof", "readonly", "infer", "unique", "string", "any", "type", "of", "as", "is", "async", "await", "yield", "let", "static", "public", "abstract", "asserts", "out", "this", "new", "typeof", "import", "function", "const", "void", "null", "if", "class"],
    w => `{ [${w} in A]: B }`,
  ),
  ...each(
    ["keyof", "readonly", "infer", "unique", "string", "any", "type", "of", "as", "is", "async", "asserts", "abstract", "out", "this", "new", "typeof", "import", "function", "const", "void", "in"],
    w => `{ [${w}: string]: B }`,
  ),
];

const heritage = [
  "A", "A, B", "A<B>", "A<B>, C<D>", "A.B", "A.B.C<D>", "A<B<C>>", "A<B<C<D>>>", "A,", ", A", "A,, B", "", "A B",
  "A[]", "A[B]", "A | B", "A & B", "(A)", "(A)<B>", "typeof x", "keyof A", "A extends B ? C : D", "{}", "{ a: A }", "[A]",
  "() => void", "new () => A", "string", "void", "null", "this", "this.A", "super", "super.A", "1", '"s"', "`t`", "-1",
  "A<B>.C", "A<>", "A<B,>", "A?.B", "A!", "A!.B", "A()", "A()<B>", "A.B()", "A[0]", 'A["b"]', "A`t`", "new A", "new A()",
  "A as B", "A satisfies B", "a ? B : C", "A.#b", "A.class", "A.default", "class {}", "function () {}", "import('m')",
  "import('m').A", "import.meta", "typeof import('m')", "unique symbol", "readonly A[]", "infer A", "asserts a", "a is A",
  "A\n<B>", "A<B>\n", "A.\nB", "await A", "yield A", "async", "type", "of", "as", "any", "undefined", "object",
  "implements", "extends", "A extends B", "A implements B", "A<B> extends C<D>",
];

const interfaces = [
  "interface I {}", "interface I { a: A }", "interface I<T> {}", "interface I<T extends A = B> {}", "interface I<in T, out U, in out V> {}",
  "interface I<const T> {}", "interface I<> {}", "interface I<T,> {}", "interface I<public T> {}", "interface I {};", "interface I {} interface J {}",
  "interface I { a: A } interface I { b: B }", "interface\nI {}", "interface I\n{}", "interface I<T>\n{}", "interface I {", "interface {}",
  "interface I", "interface I;", "interface I = {}", "interface I()", "interface I.J {}", 'interface "I" {}', "interface 1 {}",
  "interface I implements A {}", "interface I extends A implements B {}", "interface I implements A extends B {}",
  "interface I extends A extends B {}", "interface I extends A, B extends C {}", "interface I extends {}",
  "export interface I {}", "export default interface I {}", "export default interface {}", "export default interface I<T> extends A<T> {}",
  "declare interface I {}", "export declare interface I {}", "declare export interface I {}", "abstract interface I {}",
  "async interface I {}", "static interface I {}", "public interface I {}", "const interface I {}", "@d interface I {}",
  "{ interface I {} }", "function f() { interface I {} }", "if (a) interface I {}", "label: interface I {}",
  "namespace N { interface I {}; export interface J {} }", "class C { interface I {} }", "for (;;) interface I {}",
  "interface;", "interface = 1;", "interface();", "interface.a;", "var interface = 1;", "let interface: A;", "interface\n{}",
  "interface\nI\n{}", "a = interface;", "interface + 1;", "interface ? a : b;", "interface => 1;", "(interface) => 1;",
  ...each(
    ["as", "type", "of", "is", "async", "await", "yield", "let", "static", "public", "private", "protected", "implements", "package", "abstract", "declare", "readonly", "keyof", "infer", "unique", "asserts", "out", "override", "accessor", "global", "namespace", "module", "require", "constructor", "from", "get", "set", "using", "defer", "satisfies", "intrinsic", "interface", "any", "string", "number", "boolean", "symbol", "bigint", "object", "undefined", "unknown", "never", "void", "null", "this", "true", "if", "class", "function", "default", "in", "new", "typeof", "enum", "extends", "import", "export", "var", "const", "arguments", "eval"],
    w => `interface ${w} {}`,
  ),
  ...each(heritage, h => `interface I extends ${h} {}`),
];

const aliases = [
  "type X = A;", "type X = A", "type X<T> = T;", "type X<T extends A = B> = T;", "type X<in T, out U, in out V> = T;",
  "type X<const T> = T;", "type X<> = A;", "type X<T,> = T;", "type X<,> = A;", "type X<T U> = A;", "type X<T = A, U> = T;",
  "type X<T extends> = T;", "type X<T => = T;", "type X<T extends A extends B ? C : D> = T;", "type X<T extends A<B>> = T;",
  "type X<T = A<B>> = T;", "type X<T = A<B>>= T;", "type X<T = A<B>>=T;", "type X<T>=T;", "type X<T extends A<B<C>>> = T;",
  "type X<T = A<B<C>>>= T;", "type X<public T> = T;", "type X<T extends keyof U, U> = T;", "type X<in> = A;", "type X<out> = A;",
  "type X<in in T> = T;", "type X<out out T> = T;", "type X<out in T> = T;", "type X<in out> = A;", "type X<out out> = A;",
  "type X<in const T> = T;", "type X<T[]> = A;", "type X<T.U> = A;", 'type X<"T"> = A;', "type X<this> = A;", "type X<void> = A;",
  "type\nX = A;", "type X\n= A;", "type X =\nA;", "type X<T>\n= A;", "type X = A;;", "type X = A type Y = B", "type X = A\ntype Y = B",
  "type X = A; type Y = B", "type X: A;", "type X = ;", "type X;", "type X", "type X =", "type X = A B;", "type X = A, Y = B;",
  "type X.Y = A;", 'type "X" = A;', "type 1 = A;", "type X() = A;", "type X[] = A;", "type X = A = B;", "type X == A;",
  "type = 1;", "type\n= 1;", "type;", "type();", "type.a;", "type\nX;", "type\nX\n= 1;", "var type = 1; type = 2;", "let type: type;",
  "type + 1;", "type ? a : b;", "type => 1;", "(type) => 1;", "a = type;", "type\n(a);", "type\n[a];", "type `t`;", "type++;",
  "type in a;", "type instanceof A;", "type of = 1;", "type type = type;", "type X = type;", "for (type of a) {}", "for (type in a) {}",
  "for (type X = 1;;) {}", "label: type X = 1;", "{ type X = 1; }", "function f() { type X = 1; }", "if (a) type X = 1;",
  "while (a) type X = 1;", "namespace N { type X = 1; export type Y = 2 }", "class C { type X = 1 }", "switch (a) { case 1: type X = 1; }",
  "export type X = A;", "export type X<T> = T", "export default type X = A;", "declare type X = A;", "export declare type X = A;",
  "declare export type X = A;", "abstract type X = A;", "async type X = A;", "const type X = A;", "@d type X = A;", "static type X = A;",
  "type X = intrinsic;", "type X = intrinsic.A;", "type X = intrinsic<A>;", "type X = intrinsic[];", "type X = intrinsic | A;",
  "type X<T> = intrinsic;", "let x: intrinsic;", "type intrinsic = 1;",
  ...each(
    ["as", "type", "of", "is", "async", "await", "yield", "let", "static", "public", "private", "protected", "implements", "package", "interface", "abstract", "declare", "readonly", "keyof", "infer", "unique", "asserts", "out", "override", "accessor", "global", "namespace", "module", "require", "constructor", "from", "get", "set", "using", "defer", "satisfies", "any", "string", "number", "boolean", "symbol", "bigint", "object", "undefined", "unknown", "never", "void", "null", "this", "true", "if", "class", "function", "default", "in", "new", "typeof", "enum", "extends", "import", "export", "var", "const", "arguments", "eval"],
    w => `type ${w} = 1;`,
  ),
];

writeGroup("02-object-types-interfaces-aliases-mapped.txt", "Object types, interfaces, type aliases, mapped types.", [
  { prefix: "member", kind: "atype", items: members },
  { prefix: "mapped", kind: "atype", items: mapped },
  { prefix: "iface", kind: "file", items: interfaces },
  { prefix: "alias", kind: "file", items: aliases },
]);
