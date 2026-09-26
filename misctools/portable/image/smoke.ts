// Steps S1 to S5 on a built portable bun, run on Linux directly (the kernel loads a static-pie).
//
//   bun /tmp/portable/m4/smoke.ts <path to the portable bun> <out.json>
//
// Every step records the command, the exit code and what was printed, so that "passed" can be checked.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [binary, outPath] = process.argv.slice(2);
if (binary === undefined || outPath === undefined) {
  console.error("usage: bun smoke.ts <portable bun> <out.json>");
  process.exit(2);
}
const readelf = process.env.READELF ?? "/usr/lib/llvm-current/bin/llvm-readelf";
const smoke = "/tmp/portable/m4/smoke";
const work = "/tmp/portable/m4/smoke/work";
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

interface Step {
  id: string;
  what: string;
  passed: boolean;
  evidence: unknown;
}
const steps: Step[] = [];

function run(argv: string[], cwd: string = work, timeoutMs = 120_000) {
  const started = Date.now();
  const env: Record<string, string> = { ...(process.env as Record<string, string>), NO_COLOR: "1" };
  // The binary under test must not find another bun's settings or caches through the environment.
  for (const name of ["BUN_PORTABLE_SYSROOT", "BUN_WEBKIT_PATH", "BUN_BUILD_CACHE_DIR", "GIT_SHA"]) delete env[name];
  const r = Bun.spawnSync(argv, { cwd, env, timeout: timeoutMs, stdout: "pipe", stderr: "pipe" });
  return {
    command: argv.join(" "),
    exit: r.exitCode,
    signal: r.signalCode ?? null,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    ms: Date.now() - started,
  };
}

// ─── S1 ───
{
  const headers = run([readelf, "-hlW", binary]);
  const dynamic = run([readelf, "-dW", binary]);
  const type = /^\s*Type:\s+(\S+)/m.exec(headers.stdout)?.[1];
  const segments = [...headers.stdout.matchAll(/^\s+([A-Z_]+)\s+0x[0-9a-f]+ /gm)].map(m => m[1]!);
  const needed = [...dynamic.stdout.matchAll(/\(NEEDED\)\s+(.*)$/gm)].map(m => m[1]!);
  const flags1 = /\(FLAGS_1\)\s+(.*)$/m.exec(dynamic.stdout)?.[1];
  const loads = [...headers.stdout.matchAll(/^\s+LOAD\s+(0x[0-9a-f]+) (0x[0-9a-f]+) .* (0x[0-9a-f]+)\s*$/gm)].map(m => ({
    offset: m[1],
    vaddr: m[2],
    align: m[3],
  }));
  const evidence = {
    file: run(["file", "-b", binary]).stdout.trim(),
    size: statSync(binary).size,
    elf_type: type,
    program_headers: segments,
    PT_INTERP: segments.includes("INTERP"),
    PT_TLS: segments.includes("TLS"),
    PT_DYNAMIC: segments.includes("DYNAMIC"),
    DT_NEEDED: needed,
    DT_FLAGS_1: flags1,
    load_segments: loads,
  };
  steps.push({
    id: "S1",
    what: "static-pie, no PT_INTERP, no DT_NEEDED, no PT_TLS",
    passed:
      type === "DYN" &&
      !evidence.PT_INTERP &&
      !evidence.PT_TLS &&
      needed.length === 0 &&
      (flags1 ?? "").includes("PIE"),
    evidence,
  });
}

// ─── S2 ───
{
  const version = run([binary, "--version"]);
  const revision = run([binary, "--revision"]);
  steps.push({
    id: "S2",
    what: "bun --version and bun --revision print",
    passed:
      version.exit === 0 &&
      /^\d+\.\d+\.\d+/.test(version.stdout.trim()) &&
      revision.exit === 0 &&
      /^\d+\.\d+\.\d+.*\+[0-9a-f]+/.test(revision.stdout.trim()),
    evidence: { version, revision },
  });
}

// ─── S3 ───
{
  const r = run([binary, "-e", "console.log(1+1)"]);
  steps.push({ id: "S3", what: "bun -e 'console.log(1+1)' prints 2", passed: r.exit === 0 && r.stdout === "2\n", evidence: r });
}

// ─── S4 ───
{
  const r = run([binary, join(smoke, "s4", "fetch-serve.ts")]);
  steps.push({
    id: "S4",
    what: "a TypeScript file that fetches from a local Bun.serve({port: 0})",
    passed: r.exit === 0 && r.stdout.includes("S4 OK"),
    evidence: r,
  });
}

// ─── S5 ───
{
  const test = run([binary, "test", "./trivial.test.ts"], join(smoke, "s5-test"));
  const outdir = join(work, "s5-out");
  const build = run([binary, "build", "./index.ts", "--outdir", outdir, "--target=bun"], join(smoke, "s5-build"));
  let bundle = "";
  try {
    bundle = readFileSync(join(outdir, "index.js"), "utf8");
  } catch {}
  const ranBundle = bundle === "" ? undefined : run([binary, join(outdir, "index.js")]);
  const output = test.stdout + test.stderr;
  steps.push({
    id: "S5",
    what: "bun test passes a trivial test file; bun build bundles a two-file project",
    passed:
      test.exit === 0 &&
      /^\s*3 pass/m.test(output) &&
      /^\s*0 fail/m.test(output) &&
      build.exit === 0 &&
      bundle.includes("hello, ") &&
      !/from\s+["']\.\/greet/.test(bundle) &&
      ranBundle?.exit === 0 &&
      ranBundle.stdout === "hello, portable image 21\n",
    evidence: { test, build, bundle_bytes: bundle.length, bundle_has_import_of_greet: /from\s+["']\.\/greet/.test(bundle), run_of_bundle: ranBundle },
  });
}

const reached = (() => {
  let last = "none";
  for (const s of steps) {
    if (!s.passed) break;
    last = s.id;
  }
  return last;
})();
writeFileSync(outPath, JSON.stringify({ binary, reached, steps }, null, 1) + "\n");
for (const s of steps) console.log(`${s.passed ? "PASS" : "FAIL"} ${s.id} ${s.what}`);
console.log(`reached: ${reached}`);
