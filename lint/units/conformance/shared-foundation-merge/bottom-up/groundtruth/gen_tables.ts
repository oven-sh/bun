// Prints the two case tables of runner/gostrings.ts from the output of the ground-truth program; prettier gives them the form of the file.
// usage: bun gen_tables.ts <vectors.jsonl>
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const section = (name: string) => JSON.parse(lines.find(l => l.includes(`"s":"${name}"`))!);
function pairsOf(name: string): Map<number, number> {
  const m = new Map<number, number>();
  const p = section(name).pairs as number[];
  for (let i = 0; i < p.length; i += 2) m.set(p[i], p[i + 1]);
  return m;
}

// Runs [lo, hi, step, delta]: a rune r of lo..hi with (r - lo) % step == 0 maps to r + delta. The longer of step 1 and 2 wins.
export function runsOf(m: Map<number, number>): number[] {
  const keys = [...m.keys()].sort((a, b) => a - b);
  const out: number[] = [];
  let i = 0;
  while (i < keys.length) {
    const lo = keys[i];
    const delta = m.get(lo)! - lo;
    let best = [lo, lo, 1, delta];
    let bestCount = 1;
    for (const step of [1, 2]) {
      let j = i;
      while (j + 1 < keys.length && keys[j + 1] === keys[j] + step && m.get(keys[j + 1])! - keys[j + 1] === delta) j++;
      if (j - i + 1 > bestCount) {
        best = [lo, keys[j], step, delta];
        bestCount = j - i + 1;
      }
    }
    out.push(...best);
    i += bestCount;
  }
  return out;
}

// The key of a rune is the smallest rune of its orbit under unicode.SimpleFold.
export function foldKeys(fold: Map<number, number>): Map<number, number> {
  const key = new Map<number, number>();
  for (const r of fold.keys()) {
    let min = r;
    for (let x = fold.get(r)!; x !== r; x = fold.get(x)!) if (x < min) min = x;
    if (min !== r) key.set(r, min);
  }
  return key;
}

export function tablesOf(path: string): { go: string; unicode: string; lower: number[]; fold: number[] } {
  const all = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const sec = (name: string) => JSON.parse(all.find(l => l.includes(`"s":"${name}"`))!);
  const toMap = (p: number[]) => {
    const m = new Map<number, number>();
    for (let i = 0; i < p.length; i += 2) m.set(p[i], p[i + 1]);
    return m;
  };
  const meta = sec("meta");
  return { go: meta.go, unicode: meta.unicode, lower: runsOf(toMap(sec("tolower").pairs)), fold: runsOf(foldKeys(toMap(sec("simplefold").pairs))) };
}

function literal(name: string, runs: number[]): string {
  const rows: string[] = [];
  let row = " ";
  for (let i = 0; i < runs.length; i += 4) {
    const d = runs[i + 3];
    const cell = ` 0x${runs[i].toString(16)}, 0x${runs[i + 1].toString(16)}, ${runs[i + 2]}, ${d},`;
    if (row.length + cell.length > 118) {
      rows.push(row);
      row = " ";
    }
    row += cell;
  }
  rows.push(row);
  return `const ${name}: readonly number[] = [\n${rows.join("\n")}\n];`;
}

if (import.meta.main) {
  const lower = pairsOf("tolower");
  const key = foldKeys(pairsOf("simplefold"));
  const meta = section("meta");
  console.log(`// Generated from ${meta.go} (Unicode ${meta.unicode}): ${lower.size} runes in ${runsOf(lower).length / 4} runs, ${key.size} runes in ${runsOf(key).length / 4} runs.`);
  console.log(literal("LOWER_RUNS", runsOf(lower)));
  console.log(literal("FOLD_RUNS", runsOf(key)));
}
