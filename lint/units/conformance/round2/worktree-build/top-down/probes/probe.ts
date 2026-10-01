// Probe driver: spawns the binary under test with --lint exactly as the default check does
// (stdin closed, stdout and stderr piped) and prints what came back, verbatim (JSON-escaped).
// usage: bun /tmp/conf-wb-1b/probe.ts <envName> [caseFilter]
const BIN = process.env.PROBE_BIN ?? "/workspace/wt/conformance/build/debug/bun-debug";
const P = "/tmp/conf-wb-1b/probe";
const WT = "/workspace/wt/conformance";

const base: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/root",
  BUN_FEATURE_FLAG_EXPERIMENTAL_LINT: "1",
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
};
const envs: Record<string, Record<string, string>> = {
  // no ASAN_OPTIONS at all: the defaults compiled into the binary apply
  none: { ...base },
  // what test/harness.ts gives bunEnv under an ASAN build
  harness: { ...base, ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0" },
  // what scripts/runner.node.ts sets for a test file that validates leaks
  leak: {
    ...base,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1",
    LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${WT}/test/leaksan.supp`,
  },
  // the leak env plus the exception validation that the same runner sets
  leakjsc: {
    ...base,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1",
    LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${WT}/test/leaksan.supp`,
    BUN_JSC_validateExceptionChecks: "1",
    BUN_JSC_dumpSimulatedThrows: "1",
  },
  // what the sweep is advised to pin for a debug (ASAN) child
  sweep: { ...base, BUN_ENABLE_CRASH_REPORTING: "0", ASAN_OPTIONS: "allow_user_segv_handler=1:abort_on_error=1" },
  // the gate unset
  nogate: (() => {
    const e = { ...base };
    delete (e as any).BUN_FEATURE_FLAG_EXPERIMENTAL_LINT;
    return e;
  })(),
  // without BUN_DEBUG_QUIET_LOGS
  loud: (() => {
    const e = { ...base };
    delete (e as any).BUN_DEBUG_QUIET_LOGS;
    return e;
  })(),
  // FORCE_COLOR instead of NO_COLOR
  color: (() => {
    const e: Record<string, string> = { ...base, FORCE_COLOR: "1" };
    delete e.NO_COLOR;
    return e;
  })(),
};

type Case = { name: string; cwd: string; args: string[] };
const cases: Case[] = [
  { name: "01 clean .ts", cwd: P, args: ["clean.ts"] },
  { name: "02 `const = ;` in .ts", cwd: P, args: ["bad.ts"] },
  { name: "03a clean .tsx", cwd: P, args: ["ok.tsx"] },
  { name: "03b .tsx with mismatched tag", cwd: P, args: ["bad.tsx"] },
  { name: "04a .js with debugger", cwd: P, args: ["dbg.js"] },
  { name: "04b .ts with debugger", cwd: P, args: ["dbg.ts"] },
  { name: "05a .d.ts with syntax error", cwd: P, args: ["bad.d.ts"] },
  { name: "05b .d.ts ambient const without initializer", cwd: P, args: ["ok.d.ts"] },
  { name: "06 .json operand", cwd: P, args: ["data.json"] },
  { name: "07a missing .ts", cwd: P, args: ["missing.ts"] },
  { name: "07b missing .d.ts", cwd: P, args: ["missing.d.ts"] },
  { name: "07c a directory as operand", cwd: P, args: ["sub"] },
  { name: "07d a directory named x.ts", cwd: P, args: ["other"] },
  { name: "08a two operands: bad.ts dbg.js", cwd: P, args: ["bad.ts", "dbg.js"] },
  { name: "08b two operands reversed: dbg.js bad.ts", cwd: P, args: ["dbg.js", "bad.ts"] },
  { name: "08c two operands: clean.ts bad.ts", cwd: P, args: ["clean.ts", "bad.ts"] },
  { name: "08d the same operand twice", cwd: P, args: ["bad.ts", "bad.ts"] },
  { name: "08e same file, two spellings", cwd: P, args: ["bad.ts", "./bad.ts"] },
  { name: "08f missing + json + bad.ts", cwd: P, args: ["missing.ts", "data.json", "bad.ts"] },
  { name: "09a CR LF file", cwd: P, args: ["crlf.ts"] },
  { name: "09b lone CR file", cwd: P, args: ["cr.ts"] },
  { name: "10a BOM .ts", cwd: P, args: ["bom.ts"] },
  { name: "10b BOM .js with debugger", cwd: P, args: ["bom.js"] },
  { name: "11a warning only .ts", cwd: P, args: ["warn.ts"] },
  { name: "11b warning only .js", cwd: P, args: ["warn.js"] },
  { name: "12a relative operand from another cwd", cwd: `${P}/other`, args: ["../sub/deep/rel.ts"] },
  { name: "12b absolute operand from another cwd", cwd: `${P}/other`, args: [`${P}/sub/deep/rel.ts`] },
  { name: "12c absolute operand from cwd /", cwd: "/", args: [`${P}/bad.ts`] },
  { name: "12d absolute operand inside cwd", cwd: P, args: [`${P}/sub/deep/rel.ts`] },
  { name: "13 path with space and parentheses", cwd: P, args: ["sp ace/a (1).ts"] },
  { name: "14 astral character before the error", cwd: P, args: ["astral.ts"] },
  { name: "15 several rules in a .js", cwd: P, args: ["rules.js"] },
  { name: "16 empty .ts", cwd: P, args: ["empty.ts"] },
  { name: "17 no operand", cwd: P, args: [] },
  // extra set
  { name: "x01 legacy HTML close comment .js", cwd: P, args: ["htmlclose.js"] },
  { name: "x02 legacy HTML close comment .ts", cwd: P, args: ["htmlclose.ts"] },
  { name: "x03 JSX key without value .tsx", cwd: P, args: ["key.tsx"] },
  { name: "x04 JSX key without value .jsx", cwd: P, args: ["key.jsx"] },
  { name: "x05 unsupported jsxRuntime pragma .tsx", cwd: P, args: ["pragma.tsx"] },
  { name: "x06 write to private method .ts (visit warning)", cwd: P, args: ["priv.ts"] },
  { name: "x07 warning and error in one .ts", cwd: P, args: ["warnerr.ts"] },
  { name: "x08 a directory named dir.ts", cwd: P, args: ["dir.ts"] },
  { name: "x09 unreadable file (mode 000, as root)", cwd: P, args: ["noperm.ts"] },
  { name: "x10 .mts .cjs .cts .mjs .jsx", cwd: P, args: ["mod.mts", "c.cjs", "e.cts", "m.mjs", "j.jsx"] },
  { name: "x11 type errors only .ts", cwd: P, args: ["typeerr.ts"] },
  { name: "x12 200000 nested parentheses .ts", cwd: P, args: ["deep.ts"] },
  { name: "x13 200000 nested arrays .js", cwd: P, args: ["deep.js"] },
  { name: "x14 1 MB clean .ts", cwd: P, args: ["big.ts"] },
  { name: "x15 --lint=value", cwd: P, args: ["__RAW__", "--lint=1", "clean.ts"] },
  { name: "x16 operand starting with - after the first", cwd: P, args: ["clean.ts", "-b.ts"] },
  { name: "x17 bun run --lint", cwd: P, args: ["__RAW__", "run", "--lint", "bad.ts"] },
  { name: "x18 -- then operand", cwd: P, args: ["--", "bad.ts"] },
  { name: "x19 unknown flag before operand", cwd: P, args: ["--fix", "bad.ts"] },
];

const envName = process.argv[2] ?? "none";
const filter = process.argv[3];
const env = envs[envName];
if (!env) throw new Error(`unknown env ${envName}`);
console.log(`# binary: ${BIN}`);
console.log(`# env ${envName}: ${JSON.stringify(Object.fromEntries(Object.entries(env).filter(([k]) => k !== "PATH")))}`);
for (const c of cases) {
  if (filter && !c.name.includes(filter)) continue;
  const t0 = performance.now();
  const proc = Bun.spawn({
    cmd: c.args[0] === "__RAW__" ? [BIN, ...c.args.slice(1)] : [BIN, "--lint", ...c.args],
    cwd: c.cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const ms = Math.round(performance.now() - t0);
  console.log(`## ${c.name}`);
  console.log(`   cwd=${c.cwd} args=${JSON.stringify(c.args)}`);
  console.log(`   exit=${proc.exitCode} signal=${proc.signalCode} ms=${ms}`);
  console.log(`   stdout=${JSON.stringify(stdout.length > 1500 ? stdout.slice(0, 1500) + `...[${stdout.length} chars]` : stdout)}`);
  console.log(`   stderr=${JSON.stringify(stderr.length > 3000 ? stderr.slice(0, 3000) + `...[${stderr.length} chars]` : stderr)}`);
}
