// Programs in which one kind of syntax is nested in itself, or follows itself in a chain, `n` times. ../code-nested-in-itself.test.ts
//
//   bun test/aot/code-nested-in-itself/forms.ts <name> <extension> <n> <folder>     writes the program there
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Form = { name: string; extension: "ts" | "js" | "tsx"; text: (n: number) => string };
const wrap = (open: string, inner: string, close: string) => (n: number) => open.repeat(n) + inner + close.repeat(n);
const expressions: [string, (n: number) => string][] = [
  ["typeof", wrap("typeof ", "x", "")],
  ["void", wrap("void ", "x", "")],
  ["not", wrap("!", "x", "")],
  ["minus", wrap("- ", "x", "")],
  ["parentheses", wrap("(", "x", ")")],
  ["calls", wrap("f(", "x", ")")],
  ["news", wrap("new f(", "x", ")")],
  ["lists", wrap("[", "x", "]")],
  ["spreads", wrap("[...", "x", "]")],
  ["objects", wrap("{ a: ", "x", " }")],
  ["object-spreads", wrap("{ ...", "x", " }")],
  ["computed-keys", wrap("{ [", "x", "]: 1 }")],
  ["arrows", wrap("() => ", "x", "")],
  ["arrows-with-parameters", wrap("(a = ", "x", ") => a")],
  ["function-expressions", wrap("function () { return ", "x", "; }")],
  ["class-expressions", wrap("class { m() { return ", "x", "; } }")],
  ["class-heritage", wrap("class extends (", "Object", ") {}")],
  ["class-fields", wrap("class { a = ", "x", "; }")],
  ["conditions", wrap("x ? ", "x", " : 1")],
  ["conditions-to-the-right", wrap("x ? 1 : ", "x", "")],
  ["conditions-as-tests", wrap("(", "x", " ? 1 : 2)")],
  ["powers", wrap("x ** ", "x", "")],
  ["assignments", wrap("x = ", "1", "")],
  ["and-to-the-right", wrap("x && (", "x", ")")],
  ["or-to-the-right", wrap("x || (", "x", ")")],
  ["nullish-to-the-right", wrap("x ?? (", "x", ")")],
  ["plus-to-the-right", wrap("x + (", "x", ")")],
  ["plus-to-the-left", n => "x" + " + x".repeat(n)],
  ["and-to-the-left", n => "x" + " && x".repeat(n)],
  ["commas", n => "(x" + ", x".repeat(n) + ")"],
  ["members", n => "x" + ".a".repeat(n)],
  ["optional-members", n => "x" + "?.a".repeat(n)],
  ["indexes", n => "x" + "[0]".repeat(n)],
  ["indexes-inside", wrap("x[", "0", "]")],
  ["call-chains", n => "x" + "()".repeat(n)],
  ["method-chains", n => "x" + ".a()".repeat(n)],
  ["templates", wrap("`${", "x", "}`")],
  ["tagged-templates", n => "x" + "``".repeat(n)],
  ["in", wrap("x in (", "x", ")")],
  ["instanceof", wrap("x instanceof (", "x", ")")],
  ["delete", wrap("delete (", "x.a", ", x).a")],
];
const asyncExpressions: [string, (n: number) => string][] = [["awaits", wrap("await ", "x", "")]];
const generatorExpressions: [string, (n: number) => string][] = [["yields", wrap("yield ", "x", "")]];
const bodies: [string, (n: number) => string][] = [
  ["blocks", wrap("{ ", "x;", " }")],
  ["ifs", wrap("if (x) ", "x;", "")],
  ["else-ifs", wrap("if (x) x; else ", "x;", "")],
  ["whiles", wrap("while (!x) ", "x;", "")],
  ["do-whiles", wrap("do ", "x;", " while (!x);")],
  ["fors", wrap("for (;!x;) ", "x;", "")],
  ["for-ofs", wrap("for (const a of []) ", "x;", "")],
  ["for-ins", wrap("for (const a in {}) ", "x;", "")],
  ["tries", wrap("try { ", "x;", " } catch {}")],
  ["catches", wrap("try {} catch { ", "x;", " }")],
  ["finallies", wrap("try {} finally { ", "x;", " }")],
  ["switches", wrap("switch (x) { case 1: ", "x;", " }")],
  ["labels", n => Array.from({ length: n }, (_, i) => `l${i}: `).join("") + "x;"],
  ["function-declarations", wrap("function g() { ", "x;", " }")],
  ["class-declarations", wrap("class C { m() { ", "x;", " } }")],
  ["static-blocks", wrap("class C { static { ", "x;", " } }")],
  ["list-patterns", n => `const ${"[".repeat(n)}a${"]".repeat(n)} = x;`],
  ["object-patterns", n => `const ${"{ a: ".repeat(n)}a${" }".repeat(n)} = x;`],
  ["pattern-defaults", n => `const ${"[a = ".repeat(1)}${"([a] = [".repeat(n)}1${"])".repeat(n)}] = [];`],
];
const types: [string, (n: number) => string][] = [
  ["type-arguments", wrap("Array<", "number", ">")],
  ["list-types", n => "number" + "[]".repeat(n)],
  ["tuple-types", wrap("[", "number", "]")],
  ["object-types", wrap("{ a: ", "number", " }")],
  ["function-types", wrap("() => ", "number", "")],
  ["parameter-types", wrap("(a: ", "number", ") => void")],
  ["union-types", wrap("string | (", "number", ")")],
  ["intersection-types", wrap("{} & (", "{}", ")")],
  ["parenthesized-types", wrap("(", "number", ")")],
  ["conditional-types", wrap("number extends string ? 1 : ", "number", "")],
  ["keyof-types", wrap("keyof ", "{}", "")],
  ["readonly-types", wrap("readonly ", "number[]", "[]")],
  ["indexed-types", n => "any" + "[0]".repeat(n)],
  ["mapped-types", wrap("{ [K in string]: ", "number", " }")],
  ["template-types", wrap("`${", "string", "}`")],
  ["typeof-import-types", wrap("Promise<", "typeof globalThis", ">")],
];
const typedExpressions: [string, (n: number) => string][] = [
  ["as", n => "x" + " as any".repeat(n)],
  ["satisfies", n => "x" + " satisfies any".repeat(n)],
  ["non-null", n => "x" + "!".repeat(n)],
  ["angle-casts", wrap("<any>", "x", "")],
  ["as-inside", wrap("(", "x", " as any)")],
  ["type-arguments-of-calls", n => `f<${"Array<".repeat(n)}number${">".repeat(n)}>(x)`],
];
const typedBodies: [string, (n: number) => string][] = [
  ["namespaces", wrap("namespace N { ", "export const a = 1;", " }")],
  ["dotted-namespaces", n => `namespace N${".N".repeat(n)} { export const a = 1; }`],
];
export const forms: Form[] = [];
for (const extension of ["js", "ts"] as const) {
  const typed = extension === "ts";
  const head = typed ? "function f(x: any): any" : "function f(x)";
  for (const [name, body] of expressions) forms.push({ name, extension, text: n => `${head} { return ${body(n)}; }\nconsole.log(typeof f);\n` });
  for (const [name, body] of asyncExpressions) forms.push({ name, extension, text: n => `async ${head.replace("): any", "): Promise<any>")} { return ${body(n)}; }\nconsole.log(typeof f);\n` });
  for (const [name, body] of generatorExpressions) forms.push({ name, extension, text: n => `${head.replace("function ", "function* ")} { return ${body(n)}; }\nconsole.log(typeof f);\n` });
  for (const [name, body] of bodies) forms.push({ name, extension, text: n => `${head} { ${body(n)} }\nconsole.log(typeof f);\n` });
}
for (const [name, body] of types) forms.push({ name, extension: "ts", text: n => `type T = ${body(n)};\nlet a: T | undefined;\nconsole.log(typeof a);\n` });
for (const [name, body] of typedExpressions) forms.push({ name, extension: "ts", text: n => `function f<T>(x: any): any { return ${body(n)}; }\nconsole.log(typeof f);\n` });
for (const [name, body] of typedBodies) forms.push({ name, extension: "ts", text: n => `${body(n)}\nconsole.log(typeof N);\n` });
forms.push({ name: "elements", extension: "tsx", text: n => `const React = { createElement: (...all: any[]) => all.length };\ndeclare namespace JSX { interface IntrinsicElements { a: any } }\nconst e = ${"<a>".repeat(n)}${"</a>".repeat(n)};\nconsole.log(typeof e);\n` });

if (import.meta.main) {
  const [name, extension, n, folder] = process.argv.slice(2);
  const form = forms.find(form => form.name === name && form.extension === extension);
  if (!form || !folder) throw new Error("usage: bun test/aot/code-nested-in-itself/forms.ts <name> <extension> <n> <folder>");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `main.${extension}`), form.text(Number(n)));
}
