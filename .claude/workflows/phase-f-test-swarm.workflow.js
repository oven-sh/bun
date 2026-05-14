export const meta = {
  name: "phase-f-test-swarm",
  description: "24 isolated worktrees, one per test area. Each: test → fix → bughunt → cherry-pick.",
  phases: [
    { title: "Spawn", detail: "one worktree-agent per test area" },
    { title: "Converge", detail: "collect results, coordinate cherry-picks" },
  ],
};

const AREAS = (args && args.areas) || [
  { id: "bun-http", glob: "test/js/bun/http/", crate: "runtime/server" },
  { id: "bun-crypto", glob: "test/js/bun/crypto/", crate: "runtime/crypto" },
  { id: "bun-ffi", glob: "test/js/bun/ffi/", crate: "runtime/ffi" },
  { id: "bun-shell", glob: "test/js/bun/shell/", crate: "runtime/shell" },
  { id: "bun-sqlite", glob: "test/js/bun/sqlite/", crate: "sql_jsc" },
  { id: "bun-util", glob: "test/js/bun/util/", crate: "runtime/api" },
  { id: "bun-spawn", glob: "test/js/bun/spawn/", crate: "runtime/api/bun" },
  { id: "bun-io", glob: "test/js/bun/io/", crate: "runtime/webcore" },
  { id: "node-fs", glob: "test/js/node/fs/", crate: "runtime/node/fs" },
  { id: "node-http", glob: "test/js/node/http/", crate: "runtime/node" },
  { id: "node-crypto", glob: "test/js/node/crypto/", crate: "runtime/node" },
  { id: "node-stream", glob: "test/js/node/stream/", crate: "runtime/webcore/streams" },
  { id: "node-buffer", glob: "test/js/node/buffer/", crate: "runtime/node" },
  { id: "node-path", glob: "test/js/node/path/", crate: "paths" },
  { id: "node-process", glob: "test/js/node/process/", crate: "runtime/node" },
  { id: "web-fetch", glob: "test/js/web/fetch/", crate: "http_jsc" },
  { id: "web-streams", glob: "test/js/web/streams/", crate: "runtime/webcore" },
  { id: "web-ws", glob: "test/js/web/websocket/", crate: "http_jsc" },
  { id: "cli-run", glob: "test/cli/run/", crate: "runtime/cli" },
  { id: "cli-install", glob: "test/cli/install/", crate: "install" },
  { id: "bundler", glob: "test/bundler/", crate: "bundler" },
  { id: "transpiler", glob: "test/transpiler/", crate: "js_parser" },
  { id: "regression", glob: "test/regression/", crate: "(mixed)" },
  { id: "resolver", glob: "test/js/bun/resolve/", crate: "resolver" },
];

const AREA_S = {
  type: "object",
  properties: {
    id: { type: "string" },
    pass: { type: "number" },
    fail: { type: "number" },
    total: { type: "number" },
    all_pass: { type: "boolean" },
    bughunt_bugs: { type: "number" },
    commits: { type: "array", items: { type: "string" } },
    branch: { type: "string" },
    notes: { type: "string" },
  },
  required: ["id", "pass", "fail", "all_pass"],
};

phase("Spawn");
log(`spawning ${AREAS.length} worktree agents`);

const results = await parallel(
  AREAS.map(
    area => () =>
      agent(
        `You own the **${area.id}** test area in an ISOLATED WORKTREE. Your goal: get all tests under ${area.glob} passing against ./target/debug/bun-rs, then bughunt the implementing crate.

**Crate focus:** src/${area.crate}/

**Loop (max 30 iterations):**
1. \`cargo build -p bun_bin 2>&1 | tail -5\` — must succeed (fix-forward if not)
2. \`timeout 60 ./target/debug/bun-rs test ${area.glob} 2>&1 | tee /tmp/area-${area.id}.log\`
3. Parse pass/fail. If all pass → goto BUGHUNT.
4. Group failures by panic-loc/assertion message. For each unique failure: read .zig spec, fix-forward in src/${area.crate}/ (or wherever the panic is). Commit each fix.
5. \`git pull --no-rebase --no-edit -X ours origin claude/phase-a-port\` (absorb other worktrees' shared-infra fixes). Goto 1.

**BUGHUNT (once all pass):**
6. For each .rs file in src/${area.crate}/ with substantial logic: read it + its .zig spec, find divergences (silent-no-ops, aliased-&mut, transmute-to-enum, mem::forget/Box::leak, missing arms, ptr::read of Drop type, wrong-discriminant per docs/PORTING.md §Forbidden). Fix each, commit.
7. Re-run tests. If still all pass → done. If regressed → revert the breaking bughunt fix.

**Commit:** \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-f(${area.id}): <what>"\`. Do NOT push (worktree branch is yours; orchestrator cherry-picks).

**HARD RULES:** Never git reset/checkout/restore. Never .zig. Edit src/ only. Compare against \`USE_SYSTEM_BUN=1 bun test ${area.glob}\` for expected behavior.

Return {id:"${area.id}", pass, fail, total, all_pass, bughunt_bugs, commits:[sha...], branch:"<worktree-branch>", notes}.`,
        { label: `area:${area.id}`, phase: "Spawn", schema: AREA_S,  },
      ),
  ),
);

phase("Converge");
const ok = results.filter(r => r && r.all_pass);
const partial = results.filter(r => r && !r.all_pass);
log(`${ok.length}/${AREAS.length} areas all-pass; ${partial.length} partial`);

// Cherry-pick all-pass worktree commits onto main branch (sequential to handle conflicts)
const cherry = [];
for (const r of [...ok, ...partial]) {
  if (!r || !r.commits || r.commits.length === 0) continue;
  const cp = await agent(
    `Cherry-pick worktree commits onto main branch. Repo /root/bun-5 (main tree, NOT worktree).

Worktree branch: ${r.branch}
Commits (oldest→newest): ${r.commits.join(" ")}
Area: ${r.id} (${r.all_pass ? "all-pass" : `${r.pass}/${r.total} pass`})

\`git -c core.hooksPath=/dev/null cherry-pick ${r.commits.join(" ")}\` — on conflict: resolve by keeping the version that makes \`cargo build -p bun_bin && timeout 10 ./target/debug/bun-rs test ${AREAS.find(a => a.id === r.id).glob}\` pass. Then push.

Return {id:"${r.id}", picked:N, conflicts:N, notes}.`,
    {
      label: `cherry:${r.id}`,
      phase: "Converge",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          picked: { type: "number" },
          conflicts: { type: "number" },
          notes: { type: "string" },
        },
        required: ["id", "picked"],
      },
    },
  );
  cherry.push(cp);
}

return { areas: AREAS.length, all_pass: ok.length, partial: partial.length, results, cherry };
