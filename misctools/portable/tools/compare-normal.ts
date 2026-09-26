// Shows that a change leaves the normal builds of bun as they were: the machine code of crates of two
// trees, built for a target of a normal build, compared function by function (compare-asm.ts).
//
//   bun compare-normal.ts --before <tree> --after <tree> --target <triple>... [--crate <name>...]
//                         [--work <dir>] [--out <file.json>]
//
// Each crate is built with `cargo rustc --release -- --emit=asm -C codegen-units=1` in both trees.
// A target of another system needs no SDK for that: nothing is linked. Exits with 1 if a function
// differs or is in one of the two only.
//
// WORK (default /tmp/portable/n3) holds cargo's directories, one for each tree and target.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const argv = process.argv.slice(2);
const values = (name: string) => {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === name) for (let k = i + 1; k < argv.length && !argv[k].startsWith("--"); k++) out.push(argv[k]);
  return out;
};
const before = values("--before")[0];
const after = values("--after")[0];
const targets = values("--target");
const crates = values("--crate").length ? values("--crate") : ["bun_core", "bun_errno", "bun_paths", "bun_sys"];
const work = resolve(values("--work")[0] ?? process.env.WORK ?? "/tmp/portable/n3");
if (!before || !after || !targets.length) throw new Error("usage: bun compare-normal.ts --before <tree> --after <tree> --target <triple>... [--crate <name>...]");
const codegen = process.env.BUN_CODEGEN_DIR ?? join(work, "codegen");

function assembly(tree: string, target: string, crate: string): string {
  const targetDir = join(work, "target", `asm-${basename(resolve(tree))}`);
  const result = Bun.spawnSync(["cargo", "rustc", "-p", crate, "--release", "--target", target, "--", "--emit=asm", "-Ccodegen-units=1", "-Zlocation-detail=none"], {
    cwd: tree,
    env: { ...process.env, BUN_CODEGEN_DIR: codegen, CARGO_BUILD_JOBS: process.env.JOBS ?? "8", CARGO_TARGET_DIR: targetDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`${tree}, ${target}, ${crate}:\n${result.stderr.toString().split("\n").slice(-30).join("\n")}`);
  // Where cargo puts what rustc emits depends on its version: the newest file of the crate under the
  // directory of the target and the profile.
  const root = join(targetDir, target, "release");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.startsWith(`${crate}-`) && name.endsWith(".s")) found.push(path);
    }
  };
  walk(root);
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!found.length) throw new Error(`${root}: no assembly of ${crate}`);
  return found[0];
}

mkdirSync(join(work, "out"), { recursive: true });
const rows: { target: string; crate: string; functions_in_both: number; same: number; different: unknown[]; only_before: string[]; only_after: string[] }[] = [];
for (const target of targets) {
  for (const crate of crates) {
    const a = assembly(before, target, crate);
    const b = assembly(after, target, crate);
    const compared = Bun.spawnSync(["bun", join(here, "compare-asm.ts"), a, b], { stdout: "pipe", stderr: "inherit" });
    const result = JSON.parse(compared.stdout.toString());
    rows.push({ target, crate, ...result });
    console.log(`${target} ${crate}: ${result.same} of ${result.functions_in_both} functions the same, ${result.different.length} differ, ${result.only_before.length} only before, ${result.only_after.length} only after`);
    for (const entry of result.different) console.log(`   differs: ${entry.name} (${entry.lines_before} lines before, ${entry.lines_after} after${entry.same_instructions_in_another_order ? ", the same instructions in another order" : ""})`);
    for (const name of result.only_before) console.log(`   only before: ${name}`);
    for (const name of result.only_after) console.log(`   only after: ${name}`);
  }
}
const out = values("--out")[0];
if (out) writeFileSync(out, JSON.stringify({ before, after, rows }, null, 1) + "\n");
if (!existsSync(codegen)) console.log(`note: ${codegen} does not exist`);
process.exit(rows.some(row => row.different.length || row.only_before.length || row.only_after.length) ? 1 : 0);
