export const meta = {
  name: "phase-f-reviewed-refactor",
  description: "Per-worktree: apply refactor → build → 2-vote adversarial review → fix → loop until accepted",
  phases: [
    { title: "Apply", detail: "agent applies the refactor in worktree, commits" },
    { title: "Build", detail: "cargo check + bun bd smoke" },
    {
      title: "Review",
      detail: "2 adversarial reviewers: UB? semantics changed? perf regressed? anti-pattern actually fixed?",
    },
    { title: "Fix", detail: "apply reviewer findings" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
if (!A.worktree) throw new Error("worktree required; args=" + JSON.stringify(A));
const WT = A.worktree;
const BRANCH = A.branch || `claude/phase-f-${WT.replace(/^.*bun-5-/, "")}`;
const GOAL =
  A.goal ||
  (() => {
    throw new Error("goal required");
  })();
const SCOPE = A.scope || "src/";
const ANTI = A.anti_pattern || "";
const CHECK_CMD = A.check_cmd || "cargo check --workspace --keep-going";
const SMOKE = A.smoke || `bun bd -e 'console.log(1+1)' 2>&1 | head -5`;
const MAX_ROUNDS = A.max_rounds || 6;

const APPLY_S = {
  type: "object",
  properties: {
    applied: { type: "boolean" },
    files_touched: { type: "array", items: { type: "string" } },
    commit: { type: "string" },
    metric_before: { type: "number" },
    metric_after: { type: "number" },
    notes: { type: "string" },
  },
  required: ["applied", "commit", "notes"],
};
const BUILD_S = {
  type: "object",
  properties: {
    check_ok: { type: "boolean" },
    smoke_ok: { type: "boolean" },
    errors: { type: "array", items: { type: "string" } },
    smoke_output: { type: "string" },
  },
  required: ["check_ok", "smoke_ok"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    accept: { type: "boolean" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "number" },
          what: { type: "string" },
          why_wrong: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["file", "what", "why_wrong", "fix", "severity"],
      },
    },
    anti_pattern_remaining: { type: "number" },
    perf_concerns: { type: "array", items: { type: "string" } },
  },
  required: ["accept", "bugs"],
};
const FIX_S = {
  type: "object",
  properties: { bugs_fixed: { type: "number" }, commit: { type: "string" }, notes: { type: "string" } },
  required: ["bugs_fixed"],
};

const HARD = `**HARD RULES:** Work ONLY in ${WT} on branch ${BRANCH}. Never git reset/checkout/stash/rebase/pull. Never edit .zig. Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' Cargo.toml Cargo.lock && git -c core.hooksPath=/dev/null commit -q -m "..."\`. NO push.`;

let history = [];
let last_commit = "HEAD~0";

for (let round = 1; round <= MAX_ROUNDS; round++) {
  // ── Apply ──
  phase("Apply");
  const apply = await agent(
    `Apply refactor in worktree ${WT} (round ${round}). Branch ${BRANCH}.

**Goal:** ${GOAL}

**Scope:** ${SCOPE}
${ANTI ? `**Anti-pattern to eliminate:** ${ANTI}` : ""}
${round > 1 ? `**Previous round findings:** ${JSON.stringify(history[history.length - 1]?.review_bugs || [], null, 2).slice(0, 4000)}` : ""}

**Process:**
1. ${round === 1 ? "Read docs/PORTING.md + docs/RUST_PATTERNS.md for conventions." : "Continue from previous round; address reviewer bugs above."}
2. Apply the refactor. Real implementation (port from .zig where applicable), NOT stubs/todo!/type-gymnastics.
3. \`${CHECK_CMD} 2>&1 | grep -c '^error'\` → fix until 0.
4. Commit with clear message.
5. Record metric before/after if applicable.

${HARD}

Return {applied, files_touched, commit:"<sha>", metric_before, metric_after, notes}.`,
    { label: `apply-r${round}`, phase: "Apply", schema: APPLY_S },
  );
  if (!apply) {
    history.push({ round, error: "apply agent returned null" });
    break;
  }
  // applied:false on round>1 with prior fixes addressed = nothing-more-to-do; proceed to re-review
  if (!apply.applied && round === 1) {
    history.push({ round, error: "round-1 apply failed", apply });
    break;
  }
  last_commit = apply.commit || last_commit;

  // ── Build ──
  phase("Build");
  const build = await agent(
    `Build verify in ${WT}. Run:
1. \`${CHECK_CMD} 2>&1 | grep 'could not compile\\|^error\\['\` → list errors (empty if clean)
2. \`${SMOKE}\` → capture output
Return {check_ok, smoke_ok, errors:[...], smoke_output}. DO NOT edit.`,
    { label: `build-r${round}`, phase: "Build", schema: BUILD_S },
  );
  if (!build) {
    history.push({ round, error: "build probe failed" });
    continue;
  }

  // ── Review (2-vote adversarial) ──
  phase("Review");
  const reviews = await parallel(
    [0, 1].map(
      i => () =>
        agent(
          `Adversarially review the refactor diff in ${WT}. You are reviewer ${i + 1}/2.

**Goal claimed:** ${GOAL}
**Build status:** check_ok=${build.check_ok}, smoke_ok=${build.smoke_ok}${build.errors?.length ? `, errors: ${build.errors.slice(0, 5).join("; ")}` : ""}

**Read the diff (THREE-DOT — only this branch's commits, not phantom reverts of main's progress):** \`git -C ${WT} diff origin/claude/phase-a-port...HEAD -- '${SCOPE}'\` (or \`git -C ${WT} log -p --reverse origin/claude/phase-a-port..HEAD\`)

**Look for (in order of severity):**
1. **NEW non-FFI unsafe:** \`git -C ${WT} diff origin/claude/phase-a-port...HEAD | grep '^+.*unsafe {'\` (THREE-DOT) — for each: is it an extern/FFI call? If NOT → REJECT (fix = take \`&mut T\`, push deref to caller).
2. **Layering workaround instead of fix:** new runtime-registered hook, \`*mut c_void\` type-erase round-trip, \`transmute\` between crate types, duplicated type → REJECT (fix = move type down or \`extern "Rust"\`).
3. **UB introduced:** new aliasing &mut, transmute lifetime extension, uninit reads, data races, ptr provenance loss
4. **Semantics changed vs .zig spec:** read the .zig file at the same path. Does the Rust now diverge (different control flow, error handling, side effects, alloc/free pairing)?
5. **Anti-pattern NOT actually fixed:** ${ANTI ? `\`grep -rn '${ANTI}' ${WT}/${SCOPE}\` — still present?` : "did the refactor achieve the goal, or just move code around?"}
6. **Performance regressed:** new alloc per-call, new indirection on hot path, lost monomorphization, lost inline
7. **Incorrectness:** off-by-one, wrong match arm, missed error case

**accept:true** ONLY if no severity:"ub" or severity:"semantics" findings AND build is clean. Otherwise accept:false.

DO NOT edit. Return {accept, bugs:[{file,line,what,why_wrong,fix,severity:"ub|semantics|perf|style"}], anti_pattern_remaining:N, perf_concerns:[...]}.`,
          { label: `review${i}-r${round}`, phase: "Review", schema: REVIEW_S },
        ),
    ),
  );

  const all_bugs = reviews.filter(Boolean).flatMap(r => r.bugs || []);
  const dedup = [];
  const seen = {};
  for (const b of all_bugs) {
    const k = `${b.file}:${b.line}:${(b.what || "").slice(0, 60)}`;
    if (!seen[k]) {
      seen[k] = 1;
      dedup.push(b);
    }
  }
  const accepted =
    reviews.filter(Boolean).length >= 2 && reviews.every(r => r && r.accept) && build.check_ok && build.smoke_ok;

  history.push({ round, apply, build, accepted, review_bugs: dedup });
  log(`r${round}: ${accepted ? "ACCEPTED" : `rejected (${dedup.length} bugs)`} — ${apply.notes?.slice(0, 100)}`);

  if (accepted) return { rounds: round, accepted: true, history, branch: BRANCH };

  // ── Fix ──
  if (dedup.length === 0) {
    log(`r${round}: rejected but no bugs — build broken`);
    continue;
  }
  phase("Fix");
  await agent(
    `Apply reviewer findings in ${WT}. Branch ${BRANCH}.

**${dedup.length} bugs found by 2-vote review:**
${dedup.map((b, i) => `${i + 1}. [${b.severity}] **${b.file}${b.line ? `:${b.line}` : ""}**: ${b.what}\n   WHY: ${b.why_wrong}\n   FIX: ${b.fix}`).join("\n")}

Apply each fix. Read .zig spec to confirm semantics. Re-check. Commit.

${HARD}

Return {bugs_fixed:N, commit, notes}.`,
    { label: `fix-r${round}`, phase: "Fix", schema: FIX_S },
  );
}

return { rounds: MAX_ROUNDS, accepted: false, history, branch: BRANCH };
