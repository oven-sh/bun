// bun run.ts [case...] : builds each case with the base and the PR binary and compares. ASSIGN=1: useDefineForClassFields false.
import { mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { cases } from "./cases";
const only = process.argv.slice(2);
const bins = { base: process.env.BASE_BIN ?? "/tmp/bun-base-debug", pr: process.env.PR_BIN ?? "/tmp/bun-pr-debug2" } as const;
const more = process.env.ASSIGN ? { useDefineForClassFields: false } : {};
const tsconfig = JSON.stringify({ compilerOptions: { strict: true, ...more, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], lib: ["esnext"] } });
async function run(cmd: string[], cwd: string) {
  const proc = Bun.spawn({ cmd, cwd, env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return { stdout, stderr, exitCode: await proc.exited };
}
const report: string[] = [];
for (const [name, files] of Object.entries(cases)) {
  if (only.length && !only.includes(name)) continue;
  const root = join("/tmp/matrix/work", name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "tsconfig.json"), tsconfig);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "m", version: "1.0.0", compilerOptions: { strict: true, lib: ["esnext"], ...more } }));
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, "src", path), text);
  const result: Record<string, { files: string[]; warn: string; errors: string[]; typed: string }> = {};
  for (const [which, bin] of Object.entries(bins)) {
    rmSync(join(root, "out"), { recursive: true, force: true });
    const built = await run([bin, "build", "./src/index.ts", "--outdir", "out", "--dts", "--define", "__DEV__=false"], root);
    const files = existsSync(join(root, "out")) ? readdirSync(join(root, "out")).sort() : [];
    let errors: string[] = [];
    if (files.includes("index.aot.ts")) {
      const checked = await run([bin, "check"], root);
      errors = (checked.stdout + checked.stderr).split("\n").filter(line => line.startsWith("out/index.aot.ts")).map(line => line.replace(/^out\/index\.aot\.ts\(\d+,\d+\): error /, ""));
    }
    const typed = files.includes("index.aot.ts") ? readFileSync(join(root, "out/index.aot.ts"), "utf8") : "";
    result[which] = { files, warn: built.stderr.trim() + (built.exitCode ? ` [exit ${built.exitCode}]` : ""), errors, typed };
    rmSync(join(root, "out-" + which), { recursive: true, force: true });
    if (existsSync(join(root, "out"))) await run(["mv", "out", "out-" + which], root);
  }
  const { base, pr } = result;
  const lines = [`## ${name}`];
  lines.push(`files base: ${base.files.join(" ")} | pr: ${pr.files.join(" ")}`);
  if (base.warn || pr.warn) lines.push(`warn base: ${base.warn || "-"}\nwarn pr:   ${pr.warn || "-"}`);
  for (const file of base.files.filter(file => !file.endsWith(".aot.ts"))) {
    const same = pr.files.includes(file) && readFileSync(join(root, "out-base", file), "utf8") === readFileSync(join(root, "out-pr", file), "utf8");
    if (!same) lines.push(`DIFFERENT OUTPUT: ${file}`);
  }
  if (base.files.includes("index.aot.ts") && !pr.files.includes("index.aot.ts")) lines.push("REGRESSION: typed file left out by pr");
  const fresh = pr.errors.filter(error => !base.errors.includes(error));
  const gone = base.errors.filter(error => !pr.errors.includes(error));
  if (fresh.length) lines.push("NEW ERRORS in pr typed file as a source:\n  " + fresh.join("\n  "));
  if (gone.length) lines.push("errors gone: " + gone.length + " (" + [...new Set(gone.map(error => error.slice(0, 6)))].join(",") + ")");
  const a = base.typed.split("\n"), b = pr.typed.split("\n");
  lines.push(...a.filter(line => !b.includes(line)).map(line => "  - " + line.trim()), ...b.filter(line => !a.includes(line)).map(line => "  + " + line.trim()));
  report.push(lines.join("\n"));
  console.log(lines.join("\n"));
}
writeFileSync(process.env.ASSIGN ? "/tmp/matrix/report-assign.txt" : "/tmp/matrix/report.txt", report.join("\n\n") + "\n");
