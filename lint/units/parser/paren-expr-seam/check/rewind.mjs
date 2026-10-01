// usage: BUN_LINT_SEAM_OUT=<file> <v2x bun-profile> rewind.mjs    prints the records of each input (P open close operandLoc tag, A owner typeStart next, R arrowLoc typeStart next)
import { readFileSync, existsSync, statSync } from "node:fs";
const dump = process.env.BUN_LINT_SEAM_OUT;
const inputs = [
  "x = a ? (b) : c => (d);",
  "x = a ? (b) : c => (d) : e;",
  "x = a ? (b): c => ((d), (e)) : (f);",
  "x = a ? ((b), (c)) : (d);",
  "switch (x) { case (a): (b); }",
  "x = a ? (b: T): U => (c) : (d);",
  "x = a ? (b: T = (e)): U => (c) : (d: V) => (f);",
  "f = (a: A, { b }: B, ...c: C[]): R => ((a));",
  "g = async (a: A): Promise<R> => (a);",
  "h = <T,>(a: T): T => (a);",
  "v = <T>(a);",
  "w = - (a) * ((b) + (c));",
  "@(dec) class K {}",
  "y = a ? (b) ? (c) : (d) : (e);",
];
const t = new Bun.Transpiler({ loader: "ts" });
let off = existsSync(dump) ? statSync(dump).size : 0;
for (const src of inputs) {
  let out; try { out = "OK  " + t.transformSync(src).trim().replace(/\s+/g, " "); } catch (e) { out = "ERR " + (e.errors?.[0]?.message ?? e.message); }
  const all = existsSync(dump) ? readFileSync(dump, "utf8") : "";
  const part = Buffer.from(all).subarray(off).toString().trim().split("\n").filter(l => l && !l.startsWith("F "));
  off = Buffer.byteLength(all);
  console.log(JSON.stringify(src)); console.log("   " + out); for (const l of part) { const f = l.split(" "); console.log("   " + l + (f[0] === "P" ? "   " + JSON.stringify(src.slice(+f[1], +f[2] + 1)) : f[0] === "A" ? "   owner " + JSON.stringify(src.slice(+f[1], +f[1] + 3)) + " type at " + JSON.stringify(src.slice(+f[2], +f[3])) : "   arrow at " + f[1] + " type at " + JSON.stringify(src.slice(+f[2], +f[3])))); }
}
