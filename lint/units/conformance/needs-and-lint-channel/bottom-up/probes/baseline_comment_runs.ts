import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
function scan(dir: string, recursive: boolean) {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (recursive) walk(p); } else if (e.name.endsWith(".errors.txt")) files.push(p); } };
  walk(dir);
  let run = 0, marker = 0, bytes = 0;
  for (const f of files) {
    const t = readFileSync(f, "utf8"); bytes += t.length;
    let r = 0, hit = false;
    for (const l of t.split("\n")) { if (l.trimStart().startsWith("//")) { if (++r >= 2) { hit = true; break; } } else r = 0; }
    if (hit) run++;
    if (/TODO|FIXME|XXX|HACK/.test(t)) marker++;
  }
  return { files: files.length, withSlashRun: run, withMarker: marker };
}
console.log("TypeScript tests/baselines/reference/*.errors.txt", JSON.stringify(scan("/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference", false)));
console.log("typescript-go submodule/**/*.errors.txt", JSON.stringify(scan("/workspace/ref/typescript-go/testdata/baselines/reference/submodule", true)));
