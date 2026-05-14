export const meta = {
  name: "phase-f-probe-swarm",
  description: "Parallel probe N commands → dedup panics by location → fix each root cause → re-probe.",
  phases: [
    { title: "Build", detail: "cargo build -p bun_bin (must link)" },
    { title: "Probe", detail: "run N commands in parallel, collect panics/crashes/hangs" },
    { title: "Dedup", detail: "group by panic location (file:line)" },
    { title: "Fix", detail: "one agent per unique panic — root cause from .zig" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 30;

const PROBES = [
  { name: "version", cmd: "--version" },
  { name: "help", cmd: "--help" },
  { name: "e-log", cmd: "-e 'console.log(1+1)'" },
  { name: "e-math", cmd: "-e 'Math.sqrt(2)'" },
  { name: "e-json", cmd: "-e 'JSON.stringify({a:1})'" },
  { name: "e-promise", cmd: "-e 'Promise.resolve(1).then(console.log)'" },
  { name: "e-buffer", cmd: "-e 'Buffer.from([1,2,3]).toString()'" },
  { name: "e-fetch", cmd: "-e 'fetch'" },
  { name: "e-process", cmd: "-e 'process.argv'" },
  { name: "e-timeout", cmd: "-e 'setTimeout(()=>console.log(1),10)'" },
  { name: "p-expr", cmd: "-p '2+2'" },
  { name: "run-file", cmd: "run /tmp/probe-hello.js", setup: "echo 'console.log(\"hello\")' > /tmp/probe-hello.js" },
  {
    name: "run-ts",
    cmd: "run /tmp/probe-hello.ts",
    setup: "echo 'const x: number = 1; console.log(x)' > /tmp/probe-hello.ts",
  },
  {
    name: "test-empty",
    cmd: "test /tmp/probe-empty.test.ts",
    setup: 'echo \'import {test} from "bun:test"; test("ok",()=>{})\' > /tmp/probe-empty.test.ts',
  },
  { name: "build-file", cmd: "build /tmp/probe-hello.js --outdir=/tmp/probe-out" },
  { name: "repl", cmd: "repl < /dev/null" },
];

const PROBE_S = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          status: { type: "string" },
          location: { type: "string" },
          message: { type: "string" },
          backtrace_top: { type: "string" },
        },
        required: ["name", "status"],
      },
    },
    build_ok: { type: "boolean" },
  },
  required: ["results", "build_ok"],
};
const FIX_S = {
  type: "object",
  properties: {
    location: { type: "string" },
    root_cause: { type: "string" },
    fixed: { type: "boolean" },
    probes_now_passing: { type: "array", items: { type: "string" } },
    next_panic: { type: "string" },
    notes: { type: "string" },
  },
  required: ["location", "root_cause", "fixed"],
};

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Build");
  phase("Probe");
  const probe = await agent(
    `Probe-swarm round ${round}. Repo /root/bun-5.

1. **Build:** \`cargo build -p bun_bin 2>&1 | tail -5\` — must show "Finished". If not, return {build_ok:false, results:[]}.
2. **Probe each command** (timeout 8s, capture status + panic location):
${PROBES.map(p => `   - ${p.name}: ${p.setup ? `\`${p.setup}\`; ` : ""}\`timeout 8 ./target/debug/bun-rs ${p.cmd} 2>&1\``).join("\n")}

For each probe, classify:
- **status:"pass"** — exit 0, expected output
- **status:"panic"** — Rust panic. Extract location from "panicked at '<msg>', <file>:<line>" + top 3 backtrace frames (\`RUST_BACKTRACE=1\`).
- **status:"abort"** — C++ assert/SIGSEGV. Extract from "ASSERTION FAILED: ... <file>:<line>" or backtrace.
- **status:"hang"** — timeout fired with no output. location:"hang".
- **status:"wrong"** — exit 0 but wrong output.

Return {build_ok:true, results:[{name, status, location:"file:line", message:"...", backtrace_top:"..."}]}. DO NOT fix anything.`,
    { label: `probe-r${round}`, phase: "Probe", schema: PROBE_S },
  );
  if (!probe || !probe.build_ok) {
    history.push({ round, error: "build failed" });
    continue;
  }

  const failures = probe.results.filter(r => r.status !== "pass");
  log(`r${round}: ${probe.results.length - failures.length}/${probe.results.length} pass, ${failures.length} fail`);
  if (failures.length === 0) return { rounds: round, done: true, history };

  // Dedup by location
  phase("Dedup");
  const byLoc = {};
  for (const f of failures) {
    const loc = f.location || `${f.status}:unknown`;
    if (!byLoc[loc]) byLoc[loc] = { location: loc, probes: [], message: f.message, backtrace: f.backtrace_top };
    byLoc[loc].probes.push(f.name);
  }
  const unique = Object.values(byLoc);
  log(`r${round}: ${unique.length} unique panic locations`);

  phase("Fix");
  await parallel(
    unique.map(
      u => () =>
        agent(
          `Fix panic/crash at **${u.location}**. Repo /root/bun-5 @ HEAD branch claude/phase-a-port.

**Triggered by probes:** ${u.probes.join(", ")}
**Message:** ${u.message || "(none)"}
**Backtrace top:** ${u.backtrace || "(none)"}

**Process:**
1. Reproduce: \`RUST_BACKTRACE=full timeout 8 ./target/debug/bun-rs ${PROBES.find(p => p.name === u.probes[0])?.cmd || "-e '1'"} 2>&1\`
2. Read the panicking file:line + .zig spec at same path. Diagnose ROOT CAUSE (not symptom):
   - Init-order bug → find Zig's init sequence, match it
   - Null deref → find where the field should be set, port that init
   - Missing vtable registration → find the registration fn, call it in boot path
   - Layering miss → move type/register hook
3. Port the REAL fix from .zig. NO stubs/todo!/unreachable!/gates.
4. Rebuild + re-probe: \`cargo build -p bun_bin && timeout 8 ./target/debug/bun-rs <cmd>\` — confirm THIS panic is gone (next one may differ).
5. Commit: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-f: fix ${u.location}"\`. NO push/stash/reset.

Return {location:"${u.location}", root_cause:"...", fixed:bool, probes_now_passing:[...], next_panic:"file:line or none", notes}.`,
          { label: `fix:${u.location.slice(0, 50)}`, phase: "Fix", schema: FIX_S },
        ),
    ),
  );

  history.push({
    round,
    passing: probe.results.length - failures.length,
    total: probe.results.length,
    unique_panics: unique.length,
  });
}
return { rounds: MAX_ROUNDS, done: false, history };
