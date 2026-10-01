import { typeOutline } from "./outline.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("/workspace/bun/node_modules/typescript/lib/typescript.js");

const whole = [
  "any",
  "string[]",
  "A.B.C",
  "A<B, C>",
  "A<B<C>>",
  "A<B<C<D>>>",
  "A | B & C",
  "| A | B",
  "A | B extends C ? D : E",
  "T extends (infer U)[] ? U : never",
  "keyof A[]",
  "readonly string[]",
  "unique symbol",
  "typeof a.b<C>",
  'A["k"][number]',
  "[a: A, b?: B, ...c: C[]]",
  "[A?, ...B[]]",
  "(a: A, b?: B) => C",
  "<T extends A<B>>(a: T) => void",
  "new () => A",
  "abstract new <T>() => A",
  "{ a: A; b?: B; (c: C): D; new (e: E): F; [k: string]: G; m<T>(x: T): void }",
  "{ readonly [K in keyof T]?: T[K] }",
  "{ [K in T as U]: V }",
  "`a${B}c${D}`",
  'import("m").A<B>',
  'typeof import("m")',
  "(A)",
  '"s" | 1 | -1 | 1n | true | null | undefined | void | this',
];
console.log("// whole");
for (const text of whole) {
  const r = typeOutline(text);
  console.log(JSON.stringify(text), r.error ? "ERROR " + r.error : JSON.stringify(r.outline), r.end === text.length ? "" : "END " + r.end);
}
const before = ["A<B>= 1", "A<B<C>>= 1", "A<B<C<D>>>= 1", "A<B>[]= 1"];
console.log("// before =");
for (const text of before) {
  const r = typeOutline(text, "let x: ", ";");
  console.log(JSON.stringify(text), r.error ? "ERROR " + r.error : JSON.stringify(r.outline), "end", r.end);
}
const returns = ["x is T", "asserts x", "asserts x is T", "this is T", "A<B>", "asserts this is T"];
console.log("// return types");
for (const text of returns) {
  const r = typeOutline(text, "function f(x: any): ", " {}");
  console.log(JSON.stringify(text), r.error ? "ERROR " + r.error : JSON.stringify(r.outline), "end", r.end);
}
console.log("// type parameters");
for (const text of ["<T>", "<T, U>", "<T extends A<B>>", "<T = A<B<C>>>", "<in out T, const U extends V = W,>"]) {
  const prefix = "function f";
  const sf = ts.createSourceFile("a.ts", prefix + text + "() {}", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const f = sf.statements[0];
  const off = prefix.length;
  const list = f.typeParameters;
  const params = list.map(p => `${p.name.text}[${p.getStart(sf) - off},${p.end - off})`).join(" ");
  console.log(JSON.stringify(text), sf.parseDiagnostics.length ? "ERROR" : JSON.stringify(`{${list.pos - off},${list.end - off}} ${params}`), "close_end", text.length);
}
