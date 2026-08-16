#!/usr/bin/env bun
// Reads grouped JSON (group-by-file output) on argv[2], writes one rendered-text
// file per source file under argv[3], emits a slim manifest [{file,count,diagPath,codes}]
// on stdout.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (!process.argv[2] || !process.argv[3]) {
  process.stderr.write("Usage: split-diags <grouped.json> <out-dir>\n");
  process.exit(2);
}

const grouped = JSON.parse(readFileSync(process.argv[2], "utf8")) as Array<{
  file: string;
  count: number;
  diagnostics: Array<{ code: string; line: number; col: number; rendered: string }>;
}>;
const outDir = process.argv[3];
mkdirSync(outDir, { recursive: true });

const manifest = grouped.map(g => {
  const safe = g.file.replace(/[\\/]/g, "__");
  const diagPath = join(outDir, safe + ".txt");
  const body =
    `# ${g.count} clippy diagnostics for ${g.file}\n\n` + g.diagnostics.map(d => d.rendered.trimEnd()).join("\n\n");
  writeFileSync(diagPath, body);
  const codes = [...new Set(g.diagnostics.map(d => d.code))];
  return { file: g.file, count: g.count, diagPath, codes };
});

process.stdout.write(JSON.stringify(manifest) + "\n");
