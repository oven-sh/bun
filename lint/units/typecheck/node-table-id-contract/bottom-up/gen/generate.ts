// Writes the generated Rust files of the node table. usage: bun generate.ts <out dir of ast/> [--check]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateAst } from "./gen-ast.ts";
import { generateFlags } from "./gen-flags.ts";
import { generateKind } from "./gen-kind.ts";
import { generateMethods } from "./gen-methods.ts";
import { problems } from "./model.ts";

const outDir = process.argv[2];
const check = process.argv.includes("--check");
if (!outDir) throw new Error("usage: bun generate.ts <out dir> [--check]");
mkdirSync(outDir, { recursive: true });

const kind = generateKind();
const flags = generateFlags();
const ast = generateAst();
const methods = generateMethods();
const files: [string, string][] = [
  ["kind_generated.rs", kind.text],
  ["flags_generated.rs", flags.text],
  ["ast_generated.rs", ast.text],
  ["node_methods_generated.rs", methods.text],
];
for (const [name, text] of files) {
  const path = join(outDir, name);
  const formatted = Bun.spawnSync(["rustfmt", "--edition", "2024", "--emit", "stdout"], { stdin: Buffer.from(text + "\n") });
  if (formatted.exitCode !== 0) {
    writeFileSync(path + ".unformatted", text);
    throw new Error(`rustfmt failed for ${name}: ${formatted.stderr.toString().slice(0, 2000)}`);
  }
  const body = formatted.stdout.toString();
  if (check) {
    if (readFileSync(path, "utf8") !== body) throw new Error(`${name} is not what the generator writes`);
  } else {
    writeFileSync(path, body);
  }
  console.log(name, body.split("\n").length - 1, "lines", body.length, "bytes");
}
console.log("kinds", kind.count, "flags", JSON.stringify(flags.counts), "ast", JSON.stringify(ast.stats));
const bad = methods.report.filter(l => l.startsWith("PROBLEM"));
console.log("node methods:", methods.report.length, "rows,", methods.report.filter(l => l.startsWith("auto")).length, "auto,", methods.report.filter(l => l.startsWith("core")).length, "core,", bad.length, "problems");
writeFileSync(join(import.meta.dir, "../data/node-methods.txt"), methods.report.join("\n") + "\n");
for (const p of [...problems, ...bad]) console.log("PROBLEM", p);
if (problems.length + bad.length > 0) process.exit(1);
