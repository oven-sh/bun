// Counts the operands of the raw runs by extension: JavaScript roots, roots without a loader, declaration files alone.
import { readFileSync } from "node:fs";
const rows = readFileSync("/tmp/dccbu/raw-release-full.jsonl", "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const js = (r: string) => /\.(js|jsx|mjs|cjs)$/.test(r);
const dts = (r: string) => /\.d\.(ts|mts|cts)$/.test(r);
const loader = (r: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(r);
const count = (f: (roots: string[]) => boolean) => rows.filter(r => f(r.roots ?? [])).length;
console.log("run instances", rows.length, "with no roots recorded", count(x => x.length === 0));
console.log("a JavaScript root", count(x => x.some(js)));
console.log("a root without a loader", count(x => x.some(r => !loader(r))), rows.filter(r => (r.roots ?? []).some((x: string) => !loader(x))).map(r => `${r.kind} ${r.name}: ${r.roots.filter((x: string) => !loader(x)).join(" ")}`));
console.log("only declaration files", count(x => x.length > 0 && x.every(dts)));
console.log("more than one root", count(x => x.length > 1));
const ms = rows.filter(r => r.ms !== undefined).map(r => r.ms).sort((a, b) => a - b);
console.log("ms per process (release, load ~500): median", ms[ms.length >> 1], "p99", ms[Math.floor(ms.length * 0.99)], "max", ms[ms.length - 1]);
