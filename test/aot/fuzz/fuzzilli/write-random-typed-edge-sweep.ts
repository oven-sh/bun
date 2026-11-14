// Generates random typed programs whose loops meet the edges of what they hold (write-typed-edges.ts). The program number is the random seed.
//
//   bun write-random-typed-edge-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<families>.ts
//   bun write-random-typed-edge-sweep.ts count
import { Draws, writePrograms } from "./draw-by-seed.ts";
import { writeTypedEdge } from "./write-typed-edges.ts";

function write(seed: number): { name: string; text: string } {
  const draws = new Draws(seed);
  const functions = draws.several(3, at => writeTypedEdge(draws, at));
  const lines = [
    'const str = (v: any, d = 0): string => typeof v === "bigint" ? v + "n" : typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : v === null || typeof v !== "object" ? String(v) : d > 4 ? "..." : ArrayBuffer.isView(v) || Array.isArray(v) ? "[" + Array.from(v as any, (x: any) => str(x, d + 1)).slice(0, 60) + "]" : v instanceof Error ? v.name : "{" + Object.keys(v).slice(0, 200).map(x => x + ":" + str(v[x], d + 1)) + "}";',
    'const tr = (f: () => any): any => { try { return f(); } catch (e: any) { return "!" + (e?.name ?? e) + " " + String(e?.message ?? "").slice(0, 40); } };',
    "const p = (v: any) => console.log(str(v)); const encode = (s: string): string => new TextEncoder().encode(s).join(); const gc = (): void => { (globalThis as any).Bun.gc(true); };",
    ...functions.map(one => one.text),
    ...functions.flatMap(one => one.calls.map(call => `p(tr(() => ${call}));`)),
    "export {};",
  ]; // prettier-ignore
  return { name: functions.map(one => one.name).join("-") + ".ts", text: lines.join("\n") + "\n" };
}

writePrograms(8_000_000, write);
