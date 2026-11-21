// Generates random programs on values that generators seldom draw (write-rare-values.ts). The program number is the random seed.
//
//   bun write-random-rare-value-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<families>.ts
//   bun write-random-rare-value-sweep.ts count
import { Draws, writePrograms } from "./draw-by-seed.ts";
import { families, writeRareValues } from "./write-rare-values.ts";

function write(seed: number): { name: string; text: string } {
  const draws = new Draws(seed);
  const { next, pick } = draws;
  const drawn = draws.several(3, () => pick(Object.keys(families)));
  const functions = drawn.map((family, at) => `function f${at}(${pick(["k: number, n: number", "k: number, n: number", "k: any, n: any"])}) {\n${writeRareValues(draws, family).map(line => "  " + line).join("\n")}\n}`); // prettier-ignore
  const calls = drawn.flatMap((_, at) => [
    ...draws.several(draws.between(1, 3), () => `p("f${at}");\np(tr(() => f${at}(${pick(["0", "1", "2", "3", "5", "-1", "7"])}, ${pick(["0", "1", "2", "3", "4", "6"])})));`),
    ...(next() < 0.3 ? [`for (let r = 0; r < 3; r++) p(tr(() => f${at}(r, 2)));`] : []),
  ]); // prettier-ignore
  const lines = [
    'const SYM = Symbol("sym");',
    'const str = (v: any, d = 0): string => typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? String(v) : typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "fn" : Object.is(v, -0) ? "-0" : v === null || typeof v !== "object" ? String(v) : d > 3 ? "..." : v instanceof Date ? "D" + v.getTime() : ArrayBuffer.isView(v) ? v.constructor.name + "[" + Array.from(v as any, (x: any) => str(x, d + 1)).slice(0, 40) + "]" : Array.isArray(v) ? (v.length > 60 ? "A" + v.length : "[" + Array.from(v, x => str(x, d + 1)) + "]") : v instanceof Error ? v.name + ":" + v.message : "{" + Object.keys(v).slice(0, 30).map(x => { let y; try { y = str(v[x], d + 1); } catch (e: any) { y = "!" + e?.name; } return x + ":" + y; }) + "}";',
    "let lines = 0;",
    'const p = (...v: any[]) => { if (lines++ < 4000) console.log(v.map(x => str(x)).join(" ")); };',
    'const tr = (f: () => any): any => { try { return f(); } catch (e: any) { return "!" + (e?.name ?? e) + " " + String(e?.message ?? "").slice(0, 40); } };',
    ...functions,
    ...calls,
    "await new Promise(resolve => setTimeout(resolve, 1));",
    "export {};",
  ]; // prettier-ignore
  return { name: drawn.join("-") + ".ts", text: lines.join("\n") + "\n" };
}

writePrograms(8_000_000, write);
