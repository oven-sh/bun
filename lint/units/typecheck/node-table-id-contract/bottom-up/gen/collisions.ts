// Lists the Go functions of one namespace whose names become the same Rust name.
import { readdirSync, readFileSync } from "node:fs";
import { snake } from "./names.ts";

const R = "/workspace/ref/typescript-go/internal/";
let total = 0;
for (const pkg of ["ast", "binder", "checker", "core", "scanner", "evaluator", "jsnum", "diagnostics"]) {
  const names = new Map<string, Map<string, { go: Set<string>; at: string[] }>>();
  for (const file of readdirSync(R + pkg).sort()) {
    if (!file.endsWith(".go") || file.endsWith("_test.go")) continue;
    readFileSync(R + pkg + "/" + file, "utf8").split("\n").forEach((line, i) => {
      const m = /^func (?:\((\w+) \*?(\w+)(?:\[[^\]]*\])?\) )?(\w+)[\[(]/.exec(line);
      if (!m) return;
      const receiver = m[2] ?? "";
      const byName = names.get(receiver) ?? new Map();
      names.set(receiver, byName);
      const entry = byName.get(snake(m[3])) ?? { go: new Set<string>(), at: [] };
      byName.set(snake(m[3]), entry);
      entry.go.add(m[3]);
      entry.at.push(`${file}:${i + 1}`);
    });
  }
  const rows: string[] = [];
  for (const [receiver, byName] of names) {
    for (const [rust, entry] of byName) {
      if (entry.go.size < 2) continue;
      const go = [...entry.go].sort();
      const exported = go.filter(n => n[0] === n[0].toUpperCase());
      const rule = exported.length === 1 && go.length === 2 ? `${exported[0]} -> ${rust}_exported` : "NO RULE";
      rows.push(`${pkg}\t${receiver || "(package)"}\t${rust}\t${go.join(" ")}\t${rule}\t${entry.at.join(" ")}`);
    }
  }
  total += rows.length;
  console.log(`# ${pkg}: ${rows.length}`);
  for (const row of rows) console.log(row);
}
console.log(`# total ${total}`);
