// The table (input, old, new, tsc) of emitDecoratorMetadata, measured on the bun that runs this file.
//
// usage: bun bd table.mjs        (in the worktree, so that "new" is the debug build of the worktree)
//        bun table.mjs           (the installed bun: every row must then be "same", which checks this script)
// reads  ../out/metadata.table.tsv (old = rev 8965734d56, tsc = 6.0.2 with strictNullChecks off) and ../out/metadata.diff.tsv
// writes out/table.tsv (one row per input whose tag differed from tsc before or differs from the old one now)
//        out/summary.txt
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tagsOf } from "../metadata.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const KEYS = ["type", "paramtypes", "returntype"];
const show = t =>
  t === null
    ? "REJECTED"
    : Object.keys(t).length
      ? KEYS.filter(k => t[k] !== undefined)
          .map(k => `${k}=${Array.isArray(t[k]) ? t[k].join(" ; ") : t[k]}`)
          .join("  ")
      : "(none)";
const transpiler = new Bun.Transpiler({
  loader: "ts",
  tsconfig: JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } }),
});
const causes = new Map(
  readFileSync(join(HERE, "../out/metadata.diff.tsv"), "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(1)
    .map(l => {
      const c = l.split("\t");
      return [c[3], c[0]];
    }),
);
const rows = ["cause\tinput\told\tnew\ttsc\tverdict"];
const count = new Map();
const bump = (cause, verdict) => {
  const c = count.get(cause) ?? {};
  c[verdict] = (c[verdict] ?? 0) + 1;
  count.set(cause, c);
};
for (const line of readFileSync(join(HERE, "../out/metadata.table.tsv"), "utf8").split("\n").filter(Boolean).slice(1)) {
  const [srcJ, , , old, tsc] = line.split("\t");
  let now;
  try {
    now = show(tagsOf(transpiler.transformSync(JSON.parse(srcJ))));
  } catch {
    now = "REJECTED";
  }
  const cause = causes.get(srcJ) ?? (old === "REJECTED" ? "was rejected" : "was equal to tsc");
  const verdict =
    now === old ? (now === tsc ? "same, equal to tsc" : "same, differs from tsc") : now === tsc ? "changed, equal to tsc" : "CHANGED, DIFFERS FROM TSC";
  bump(cause, verdict);
  if (now !== old || old !== tsc) rows.push([cause, srcJ, old, now, tsc, verdict].join("\t"));
}
writeFileSync(join(OUT, "table.tsv"), rows.join("\n") + "\n");
const lines = [`bun ${Bun.version} ${Bun.revision}`];
for (const [cause, c] of [...count].sort()) lines.push(`${cause}\n    ${Object.entries(c).map(([k, v]) => `${v} ${k}`).join("; ")}`);
writeFileSync(join(OUT, "summary.txt"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
