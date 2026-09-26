/**
 * Steps S1 to S5 on a built image of bun, run on Linux directly (the kernel loads a static-pie).
 *
 *   bun image/smoke.ts <path to the image of bun> <out.json>
 *
 *   S1  static-pie, no PT_INTERP, no DT_NEEDED, no PT_TLS
 *   S2  bun --version and bun --revision print
 *   S3  bun -e 'console.log(1+1)' prints 2
 *   S4  a TypeScript file that fetches from a local Bun.serve({port: 0})
 *   S5  bun test passes a trivial test file; bun build bundles a two-file project
 *
 * Every step records the command, the exit code and what was printed, so that "passed" can be checked.
 * The files that the steps run are written to <out.json>.work/, which is deleted first.
 * Environment: READELF (default: llvm-readelf of $LLVM_BIN, or of the clang in PATH).
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { llvmBin } from "../flags.ts";

const [binaryArgument, outPath] = process.argv.slice(2);
if (binaryArgument === undefined || outPath === undefined) {
  console.error("usage: bun image/smoke.ts <image of bun> <out.json>");
  process.exit(2);
}
const binary = resolve(binaryArgument);
const readelf = process.env.READELF ?? join(llvmBin(), "llvm-readelf");
const work = `${resolve(outPath)}.work`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

/** What the steps S4 and S5 run, by the path below the work directory. */
const FILES: Record<string, string> = {
  "s4/fetch-serve.ts": `interface Reply {
  path: string;
  method: string;
  body: { n: number; text: string } | null;
}

const server = Bun.serve({
  port: 0,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const reply: Reply = {
      path: url.pathname,
      method: request.method,
      body: request.method === "POST" ? ((await request.json()) as Reply["body"]) : null,
    };
    return Response.json(reply, { headers: { "x-portable": "yes" } });
  },
});

const base = \`http://127.0.0.1:\${server.port}\`;
const get = await fetch(\`\${base}/hello\`);
const got = (await get.json()) as Reply;
const post = await fetch(\`\${base}/echo\`, { method: "POST", body: JSON.stringify({ n: 41 + 1, text: "portable" }) });
const posted = (await post.json()) as Reply;
await server.stop(true);

console.log(JSON.stringify({ status: [get.status, post.status], header: get.headers.get("x-portable"), got, posted }));
const ok =
  get.status === 200 &&
  post.status === 200 &&
  get.headers.get("x-portable") === "yes" &&
  got.path === "/hello" &&
  got.method === "GET" &&
  posted.path === "/echo" &&
  posted.body?.n === 42 &&
  posted.body?.text === "portable";
console.log(ok ? "S4 OK" : "S4 FAILED");
process.exit(ok ? 0 : 1);
`,
  "s5-test/trivial.test.ts": `import { describe, expect, test } from "bun:test";

describe("trivial", () => {
  test("arithmetic", () => {
    expect(1 + 1).toBe(2);
  });
  test("async", async () => {
    const value = await Promise.resolve("portable");
    expect(value).toBe("portable");
  });
  test("objects", () => {
    expect({ a: [1, 2, 3], b: new Map([["k", 1]]) }).toEqual({ a: [1, 2, 3], b: new Map([["k", 1]]) });
  });
});
`,
  "s5-build/index.ts": `import { greet, type Greeting } from "./greet";

const greeting: Greeting = greet("portable image");
console.log(greeting.text, greeting.length);
`,
  "s5-build/greet.ts": `export interface Greeting {
  text: string;
  length: number;
}

export function greet(name: string): Greeting {
  const text = \`hello, \${name}\`;
  return { text, length: text.length };
}
`,
};
for (const [path, text] of Object.entries(FILES)) {
  mkdirSync(join(work, path, ".."), { recursive: true });
  writeFileSync(join(work, path), text);
}

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
  const loads = [...headers.stdout.matchAll(/^\s+LOAD\s+(0x[0-9a-f]+) (0x[0-9a-f]+) .* (0x[0-9a-f]+)\s*$/gm)].map(
    m => ({
      offset: m[1],
      vaddr: m[2],
      align: m[3],
    }),
  );
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
  steps.push({
    id: "S3",
    what: "bun -e 'console.log(1+1)' prints 2",
    passed: r.exit === 0 && r.stdout === "2\n",
    evidence: r,
  });
}

// ─── S4 ───
{
  const r = run([binary, join(work, "s4", "fetch-serve.ts")]);
  steps.push({
    id: "S4",
    what: "a TypeScript file that fetches from a local Bun.serve({port: 0})",
    passed: r.exit === 0 && r.stdout.includes("S4 OK"),
    evidence: r,
  });
}

// ─── S5 ───
{
  const test = run([binary, "test", "./trivial.test.ts"], join(work, "s5-test"));
  const outdir = join(work, "s5-out");
  const build = run([binary, "build", "./index.ts", "--outdir", outdir, "--target=bun"], join(work, "s5-build"));
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
    evidence: {
      test,
      build,
      bundle_bytes: bundle.length,
      bundle_has_import_of_greet: /from\s+["']\.\/greet/.test(bundle),
      run_of_bundle: ranBundle,
    },
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
