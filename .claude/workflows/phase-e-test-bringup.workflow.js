export const meta = {
  name: "phase-e-test-bringup",
  description: "Ladder E1→E2→E3: bun test single → multi → parallel-dir. Panic-swarm pattern.",
  phases: [
    { title: "Link", detail: "cargo build -p bun_bin" },
    { title: "Probe", detail: "run test commands, collect panics" },
    { title: "Fix", detail: "one agent per unique panic location" },
  ],
};

const RUNG_CMDS = [
  // E1: single file
  {
    rung: 1,
    name: "e1-basic",
    setup: `cat > /tmp/e1.test.ts <<'EOF'
import { test, expect } from "bun:test";
test("adds", () => { expect(1+1).toBe(2); });
EOF`,
    cmd: ["test", "/tmp/e1.test.ts"],
    expect_contains: "1 pass",
  },
  {
    rung: 1,
    name: "e1-fail",
    setup: `cat > /tmp/e1f.test.ts <<'EOF'
import { test, expect } from "bun:test";
test("fails", () => { expect(1).toBe(2); });
EOF`,
    cmd: ["test", "/tmp/e1f.test.ts"],
    expect_contains: "1 fail",
  },
  {
    rung: 1,
    name: "e1-async",
    setup: `cat > /tmp/e1a.test.ts <<'EOF'
import { test, expect } from "bun:test";
test("async", async () => { await Bun.sleep(1); expect(true).toBe(true); });
EOF`,
    cmd: ["test", "/tmp/e1a.test.ts"],
    expect_contains: "1 pass",
  },
  {
    rung: 1,
    name: "e1-describe",
    setup: `cat > /tmp/e1d.test.ts <<'EOF'
import { test, expect, describe } from "bun:test";
describe("group", () => { test("a", () => expect(1).toBe(1)); test("b", () => expect(2).toBe(2)); });
EOF`,
    cmd: ["test", "/tmp/e1d.test.ts"],
    expect_contains: "2 pass",
  },
  {
    rung: 1,
    name: "e1-hooks",
    setup: `cat > /tmp/e1h.test.ts <<'EOF'
import { test, expect, beforeEach } from "bun:test";
let n = 0; beforeEach(() => { n++; });
test("a", () => expect(n).toBe(1)); test("b", () => expect(n).toBe(2));
EOF`,
    cmd: ["test", "/tmp/e1h.test.ts"],
    expect_contains: "2 pass",
  },
  // E2: multi file
  {
    rung: 2,
    name: "e2-multi",
    setup: `cat > /tmp/e2a.test.ts <<'EOF'
import { test, expect } from "bun:test"; test("a", () => expect(1).toBe(1));
EOF
cat > /tmp/e2b.test.ts <<'EOF'
import { test, expect } from "bun:test"; test("b", () => expect(2).toBe(2));
EOF`,
    cmd: ["test", "/tmp/e2a.test.ts", "/tmp/e2b.test.ts"],
    expect_contains: "2 pass",
  },
  { rung: 2, name: "e2-mixed", cmd: ["test", "/tmp/e1.test.ts", "/tmp/e1f.test.ts"], expect_contains: "1 pass" },
  // E3: parallel dir
  {
    rung: 3,
    name: "e3-dir",
    setup: `mkdir -p /tmp/e3 && for i in 1 2 3 4; do cat > /tmp/e3/t$i.test.ts <<EOF
import { test, expect } from "bun:test"; test("t$i", () => expect($i).toBe($i));
EOF
done`,
    cmd: ["test", "/tmp/e3/"],
    expect_contains: "4 pass",
  },
  { rung: 3, name: "e3-parallel", cmd: ["test", "--parallel", "/tmp/e3/"], expect_contains: "4 pass" },
];

const MAX_ROUNDS = (args && args.max_rounds) || 10;
const TARGET_RUNG = (args && args.target_rung) || 3;

const PROBE_S = {
  type: "object",
  properties: {
    name: { type: "string" },
    rung: { type: "number" },
    exit: { type: "number" },
    stdout: { type: "string" },
    stderr: { type: "string" },
    panic_loc: { type: ["string", "null"] },
    panic_msg: { type: ["string", "null"] },
    passed: { type: "boolean" },
  },
  required: ["name", "rung", "exit", "passed"],
};
const LINK_S = {
  type: "object",
  properties: { linked: { type: "boolean" }, notes: { type: "string" } },
  required: ["linked"],
};
const FIX_S = {
  type: "object",
  properties: {
    loc: { type: "string" },
    fixed: { type: "boolean" },
    action: { type: "string" },
    files: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["loc", "fixed", "action"],
};

const HARD = `**HARD RULES:** Never git reset/checkout/restore/stash. Never .zig. Commit+push with retry: \`for i in 1 2 3 4 5; do git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-e: <what>" 2>/dev/null && git -c core.hooksPath=/dev/null pull --no-rebase --no-edit -X ours origin claude/phase-a-port 2>/dev/null; git -c core.hooksPath=/dev/null push origin claude/phase-a-port && break || sleep $((RANDOM%5+1)); done\`.`;

let history = [];
let rung_reached = 0;

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Link");
  const link = await agent(
    `Ensure \`cargo build -p bun_bin\` succeeds. Repo /root/bun-5. Loop max 10×: build → if errors, fix-forward (re-gate >50-err modules); commit. ${HARD}\n\nReturn {linked:bool, notes}.`,
    { label: `link-r${round}`, phase: "Link", schema: LINK_S },
  );
  if (!link || !link.linked) {
    history.push({ round, link });
    continue;
  }

  phase("Probe");
  // Only probe rungs we haven't fully passed yet, plus regression-check passed rungs
  const cmds = RUNG_CMDS.filter(c => c.rung <= rung_reached + 1 && c.rung <= TARGET_RUNG);
  const probes = (
    await parallel(
      cmds.map(
        c => () =>
          agent(
            `Run ONE test command. Repo /root/bun-5.

${c.setup ? `Setup:\n\`\`\`sh\n${c.setup}\n\`\`\`\n` : ""}Run: \`RUST_BACKTRACE=1 timeout 10 ./target/debug/bun-rs ${c.cmd.map(a => `'${a}'`).join(" ")} 2>&1\`

Capture stdout+stderr (first 4000 chars). Extract panic location (file:line:col). passed = exit==0 && stdout includes ${JSON.stringify(c.expect_contains)}.

DO NOT edit. Return {name:${JSON.stringify(c.name)}, rung:${c.rung}, exit, stdout, stderr, panic_loc, panic_msg, passed}.`,
            { label: `probe:${c.name}`, phase: "Probe", schema: PROBE_S },
          ),
      ),
    )
  ).filter(Boolean);

  // Advance rung if all rung-N probes pass
  for (let r = rung_reached + 1; r <= TARGET_RUNG; r++) {
    const rp = probes.filter(p => p.rung === r);
    if (rp.length > 0 && rp.every(p => p.passed)) {
      rung_reached = r;
      log(`RUNG ${r} PASSED`);
    } else break;
  }
  if (rung_reached >= TARGET_RUNG) {
    return { rounds: round, rung_reached, all_pass: true, history };
  }

  const failed = probes.filter(p => !p.passed);
  const byLoc = {};
  for (const p of failed) {
    const key = p.panic_loc || `noloc:${(p.stderr || p.stdout || "").slice(0, 200)}`;
    if (!byLoc[key]) byLoc[key] = { loc: p.panic_loc, cmds: [], sample: p };
    byLoc[key].cmds.push(p.name);
  }
  const unique = Object.values(byLoc);
  log(`round ${round}: rung ${rung_reached}, ${unique.length} unique failures`);

  phase("Fix");
  const fixes = (
    await parallel(
      unique.map(
        u => () =>
          agent(
            `Fix ONE test-runner panic/failure in bun-rs. Repo /root/bun-5 @ HEAD.

**Failing:** ${u.cmds.join(", ")}
**Panic:** ${u.loc || "(see output)"} — ${u.sample.panic_msg || ""}
**Output (${u.sample.name}):**
\`\`\`
${(u.sample.stderr || u.sample.stdout || "").slice(0, 3000)}
\`\`\`

**Decide:**
- test_runner/jest/expect/BunTest/Execution → FIX FORWARD from .zig spec
- css/install/bake/unrelated → re-gate call site
- Missing extern → add to phase_c_exports.rs

Reproduce: \`RUST_BACKTRACE=full timeout 10 ./target/debug/bun-rs ${u.sample.name.startsWith("e3") ? "test /tmp/e3/" : "test /tmp/e1.test.ts"}\`. After fix: rebuild + re-run. Commit.

${HARD}

Return {loc, fixed, action, files, notes}.`,
            { label: `fix:${u.loc || u.cmds[0]}`, phase: "Fix", schema: FIX_S },
          ),
      ),
    )
  ).filter(Boolean);

  history.push({
    round,
    rung_reached,
    probes_pass: probes.filter(p => p.passed).map(p => p.name),
    unique: unique.length,
    fixes,
  });
}
return { rounds: MAX_ROUNDS, rung_reached, history };
