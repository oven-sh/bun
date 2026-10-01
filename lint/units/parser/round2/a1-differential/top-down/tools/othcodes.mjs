// usage: node othcodes.mjs <diff.jsonl>...   the codes tsc reports beside its grammar errors for the sources of the R>A records that no RESTORE entry owns
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
const codes = new Map();
for (const path of process.argv.slice(2)) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || !line.includes('"cls":"R>A"')) continue;
    const d = JSON.parse(line);
    if (d.cls !== "R>A" || /^RESTORE/.test(d.cause)) continue;
    const dialect = d.api.includes(".tsx.") ? "tsx" : "ts";
    for (const c of d.tsc?.oth?.[dialect] ?? []) {
      if (!codes.has(c)) codes.set(c, { sources: new Set(), ex: d.src, cause: d.cause });
      codes.get(c).sources.add(d.src);
    }
  }
}
for (const [c, v] of [...codes].sort((a, b) => a[0] - b[0])) console.log(`TS${c}\t${v.sources.size} sources\t${JSON.stringify(v.ex).slice(0, 70)}\t${v.cause.slice(0, 50)}`);
