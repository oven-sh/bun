#!/usr/bin/env bun
// Type parameters and type arguments.
// Reference: parseTypeParameters 3270, parseTypeParameter 3277, parseModifiersEx 3908, tryParseModifier 3968,
// parseTypeArguments 3063, parseTypeArgumentsOfTypeReference 3056, tryParseTypeArgumentsInExpression 5295,
// canFollowTypeArgumentsInExpression 5323, parseExpressionWithTypeArguments 1884.
import { each, writeGroup } from "./gen-lib.mjs";

// One type parameter list, without the angle brackets.
const typeParameterLists = [
  "T", "T, U", "T,", "T, U,", ",", ",T", "T,,U", "T U", "", "T extends A", "T = A", "T extends A = B", "T = A extends B",
  "T extends A, U extends T", "T extends keyof U, U", "T extends A | B", "T extends A & B", "T extends A[]", "T extends [A, B]",
  "T extends { a: A }", "T extends () => void", "T extends (a: A) => B", "T extends new () => A", "T extends typeof a",
  "T extends A extends B ? C : D", "T extends (A extends B ? C : D)", "T extends infer U", "T extends `t${A}`", "T extends -1",
  'T extends "s"', "T extends A<B>", "T extends A<B<C>>", "T extends A<B<C<D>>>", "T = A<B>", "T = A<B<C>>", "T extends A<B> = C<D>",
  "T extends A<B>, U", "T = A<B>, U = C<D>", "T extends", "T =", "T extends =", "T extends A =", "T extends A extends B",
  "T = A = B", "T extends 1 + 2", "T extends a.b()", "T extends (a)", "T extends !a", "T extends []", "T extends {}", "T: A",
  "T super A", "T implements A", "T?", "T!", "...T", "T[]", "T.U", "T<U>", '"T"', "1", "`T`", "#T", "this", "void", "null", "true",
  "const T", "const T extends A", "const T = A", "const T, const U", "const", "const const T", "T const", "const\nT",
  "in T", "out T", "in out T", "out in T", "in in T", "out out T", "in out in T", "in", "out", "in out", "out out", "in in",
  "out, T", "out = A", "out extends A", "in T, out U", "in out T, U", "const in T", "in const T", "const out T", "const in out T",
  "in\nT", "out\nT", "in out\nT",
  ...each(["public", "private", "protected", "readonly", "static", "abstract", "declare", "override", "async", "accessor", "export", "default"], m => `${m} T`),
  ...each(["public", "readonly", "static", "abstract", "declare", "async", "accessor", "type", "of", "as", "is", "await", "yield", "let", "keyof", "infer", "unique", "asserts", "any", "string", "number", "symbol", "object", "undefined", "unknown", "never", "get", "set", "from", "global", "module", "namespace", "constructor", "arguments", "eval", "interface", "implements", "package"], m => `${m}`),
  ...each(["class", "function", "new", "typeof", "delete", "if", "var", "enum", "import", "export", "default", "super", "extends", "instanceof"], m => `${m}`),
];

// What owns a type parameter list. "$" is the list with its angle brackets.
const owners = {
  fn: "function f$() {}",
  fnexpr: "var v = function $() {};",
  gen: "function* f$() {}",
  asyncfn: "async function f$() {}",
  arrow: "var v = $() => 1;",
  asyncarrow: "var v = async $() => 1;",
  method: "class C { m$() {} }",
  staticmethod: "class C { static m$() {} }",
  objmethod: "var v = { m$() {} };",
  cls: "class C$ {}",
  clsexpr: "var v = class $ {};",
  namedclsexpr: "var v = class C$ {};",
  iface: "interface I$ {}",
  alias: "type X$ = 1;",
  fntype: "type X = $() => void;",
  ctortype: "type X = new $() => A;",
  callsig: "type X = { $(): void };",
  ctorsig: "type X = { new $(): A };",
  methodsig: "type X = { m$(): void };",
  declfn: "declare function f$(): void;",
  declcls: "declare class C$ {}",
};

const perOwner = [];
for (const [name, template] of Object.entries(owners)) {
  perOwner.push({ prefix: `tp.${name}`, kind: "file", items: each(typeParameterLists, l => template.replace("$", `<${l}>`)) });
}

const misplaced = [
  "class C { constructor<T>() {} }", "class C { get a<T>() { return 1 } }", "class C { set a<T>(v) {} }", "class C { a<T>: A }",
  "class C { a<T> = 1 }", "class C { static<T>() {} }", "class C { async<T>() {} }", "class C { get<T>() {} }", "class C { *m<T>() {} }",
  "class C { async m<T>() {} }", "class C { async *m<T>() {} }", "class C { #m<T>() {} }", 'class C { "m"<T>() {} }', "class C { 1<T>() {} }",
  "class C { [m]<T>() {} }", "class C { m?<T>() {} }", "class C { m<T>?() {} }", "class C { m<T>(): void; m<T>(a?: T) {} }",
  "var v = { get a<T>() { return 1 } };", "var v = { a<T>: 1 };", "var v = { async m<T>() {} };", "var v = { *m<T>() {} };",
  'var v = { "m"<T>() {} };', "var v = { [m]<T>() {} };", "var v = { 1<T>() {} };", "enum E<T> {}", "namespace N<T> {}",
  "var v<T> = 1;", "let v<T>: A;", "function f<T>", "function<T> f() {}", "function f<T><U>() {}", "class C<T><U> {}",
  "class<T> C {}", "class C <T> {}", "class C\n<T> {}", "function f\n<T>() {}", "function f<T>\n() {}", "interface I\n<T> {}",
  "type X\n<T> = 1;", "class C<T> extends D<T> {}", "class C<T = A<B>> {}", "class C<T extends A<B>>{}", "class C<T = A<B>>{}",
  "function f<T = A<B>>() {}", "function f<T extends A<B<C>>>() {}", "var v = <T extends A<B>>() => 1;", "var v = <T = A<B>>() => 1;",
  "class C<T extends A<B>> extends D<E<T>> {}", "class C { m<T extends A<B>>(a: T): C<T> {} }", "declare function f<T>(): T",
  "export function f<T>() {}", "export default function <T>() {}", "export default function f<T>() {}", "export default class<T> {}",
  "export default class C<T> {}", "export default async function <T>() {}", "export default function* <T>() {}",
  "async function* f<T>() {}", "var v = async function <T>() {};", "var v = function* <T>() {};", "var v = async function* f<T>() {};",
  "(function <T>() {})", "(class <T> {})", "new (class <T> {})()", "var v = <T>(a: T) => a;", "var v = async <T>(a: T) => a;",
];

// One type argument list, without the angle brackets.
const typeArgumentLists = [
  "A", "A, B", "A,", ",", ",A", "A,,B", "A B", "", "A | B", "A & B", "| A", "& A", "A |", "A &", "A | ", "A extends B ? C : D",
  "A[]", "A[B]", "[A, B]", "{ a: A }", "{}", "() => void", "(a: A) => B", "(a = 1) => B", "<T>() => T", "<T>(a: T) => T, U",
  "new () => A", "abstract new () => A", "typeof a", "typeof a.b", "typeof a<B>", "keyof A", "readonly A[]", "unique symbol",
  "infer U", "a is A", "asserts a", "this", "void", "null", "undefined", "any", "unknown", "never", "string", "true", "false",
  "1", "-1", "1n", '"s"', "`t`", "`t${A}`", "import('m')", "import('m').A<B>", "A<B>", "A<B<C>>", "A<B<C<D>>>", "A<B>, C<D>",
  "A<B>>", "A<<B>", "A.B", "A.B.C<D>", "(A)", "(A | B)[]", "A?", "?A", "A!", "*", "...A", "A = B", "a: A", "A extends B",
  "const", "in", "out", "T extends A", "const T", "in T", "out T", "A\n", "\nA", "A\n, B", "a.b()", "a + b", "!a", "a && b", "a < b",
  "a > b", "a >> b", "a >= b", "1 + 2", "a ? b : c", "class {}", "function () {}",
];

const users = {
  call: "f$(x);",
  callnoarg: "f$();",
  newcall: "new C$(x);",
  newnoparen: "new C$;",
  tagged: "f$`t`;",
  taggedhead: "f$`t${x}u`;",
  membercall: "a.b$(x);",
  optionalcall: "a?.b$(x);",
  optionalcall2: "a?.$(x);",
  elementcall: "a[b]$(x);",
  callcall: "f(x)$(y);",
  extends: "class C extends D$ {}",
  extendsmember: "class C extends D.E$ {}",
  implements: "class C implements I$ {}",
  ifaceextends: "interface I extends J$ {}",
  typeref: "let v: A$;",
  typerefmember: "let v: A.B$;",
  typequery: "let v: typeof a$;",
  importtype: "let v: import('m').A$;",
  instantiation: "var v = f$;",
  decorator: "@d$() class C {}",
  supercall: "class C extends D { constructor() { super$(); } }",
};
const perUser = [];
for (const [name, template] of Object.entries(users)) {
  perUser.push({ prefix: `ta.${name}`, kind: "file", items: each(typeArgumentLists, l => template.replace("$", `<${l}>`)) });
}

const jsx = [
  "var v = <C<A> />;", "var v = <C<A>></C>;", "var v = <C<A, B> a={1} />;", "var v = <a.b<A> />;", "var v = <C<A<B>> />;",
  "var v = <C<A<B<D>>> />;", "var v = <C<A<B>>></C>;", "var v = <C<> />;", "var v = <C<A,> />;", "var v = <C <A> />;",
  "var v = <C\n<A> />;", "var v = <C<A>\na={1} />;", "var v = <C<() => void> />;", "var v = <C<{ a: A }> />;", "var v = <C<A | B> />;",
  "var v = <C<typeof a> />;", 'var v = <C<"s"> a="b" />;', "var v = <C<A>>text</C>;", "var v = <C<A>>{x}</C>;", "var v = <C<A>></C<A>>;",
  "var v = <c<A> />;", "var v = <a:b<A> />;", "var v = <a-b<A> />;", "var v = <C<A> {...x} />;", "var v = <C<A>/>;", "var v = <<A> />;",
  "var v = <C<A>><D<B> /></C>;", "var v = <C<A> a=<D<B> /> />;", "var v = <T,>(a: T) => a;", "var v = <T extends A>(a: T) => a;",
  "var v = <T extends A,>(a: T) => a;", "var v = <T = A>(a: T) => a;", "var v = <const T,>(a: T) => a;", "var v = <const T extends A>(a: T) => a;",
  "var v = <T>(a: T) => a;", "var v = <T extends>(a: T) => a;", "var v = <T extends={1} />;", "var v = <T extends />;", "var v = <T extends></T>;",
  "var v = <T, U>(a: T) => a;", "var v = <T,>() => <C<T> />;", "var v = async <T,>(a: T) => a;", "var v = <T,>(a: T): T => a;",
  "var v = <in T,>() => 1;", "var v = <T extends A<B>>(a: T) => a;", "var v = <T extends A<B>,>(a: T) => a;", "var v = <const>x;",
  "var v = <T>x;", "var v = <T>x</T>;", "var v = f<A>(x);", "var v = f<A>(<C />);", "var v = <C a={f<A>(x)} />;", "var v = <C a={<T,>(b: T) => b} />;",
  "var v = <C a={x as A} />;", "var v = <C a={x!} />;", "var v = <C>{x as A}</C>;", "var v = <C>{(a: A): B => a}</C>;", "var v = <C a={<A>x} />;",
  "var v = a < b > c;", "var v = a < b > (c);", "class C<T> { m = <U,>(a: U) => <D<T, U> a={a} /> }",
];

writeGroup("04-type-parameters-and-arguments.txt", "Type parameters and type arguments.", [
  ...perOwner,
  { prefix: "tp.misc", kind: "file", items: misplaced },
  ...perUser,
  { prefix: "ta.jsx", kind: "tsx", items: jsx },
]);
