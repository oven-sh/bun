export const meta = {
  name: "phase-g-test-swarm-isolated",
  description:
    "Per-shard worktree + cgroup (64G mem, pids.max). No shared /root/bun-5 contention. Survey → fix-per-sig → 2-vote review → loop.",
  phases: [
    { title: "Isolate", detail: "create worktree + cgroup for this shard" },
    { title: "Survey", detail: "run test files in cgroup, categorize" },
    { title: "Fix", detail: "fix per-signature in worktree (no main-repo contention)" },
    { title: "Review", detail: "2-vote adversarial" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const SHARD = A.shard || 0;
const NSHARDS = A.nshards || 8;
const MAX_ROUNDS = A.max_rounds || 6;
const TEST_GLOB = A.test_glob || "test/js/bun/**/*.test.{js,ts}";
const WT = `/root/bun-5-tswarm-s${SHARD}`;
const CG = `tswarm-s${SHARD}`;

const ISOLATE_S = {
  type: "object",
  properties: {
    worktree_ok: { type: "boolean" },
    cgroup_ok: { type: "boolean" },
    build_ok: { type: "boolean" },
    notes: { type: "string" },
  },
  required: ["worktree_ok", "build_ok"],
};
const SURVEY_S = {
  type: "object",
  properties: {
    completing: { type: "array", items: { type: "string" } },
    crashing: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, signature: { type: "string" } },
        required: ["file", "signature"],
      },
    },
    hanging: { type: "array", items: { type: "string" } },
    total: { type: "number" },
  },
  required: ["completing", "crashing", "total"],
};
const FIX_S = {
  type: "object",
  properties: {
    signature: { type: "string" },
    root_cause: { type: "string" },
    files_touched: { type: "array", items: { type: "string" } },
    commit: { type: "string" },
    notes: { type: "string" },
  },
  required: ["signature", "root_cause", "commit"],
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
          what: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["file", "what", "fix", "severity"],
      },
    },
  },
  required: ["accept", "bugs"],
};

const RUN_IN_CG = `systemd-run --scope --quiet -p MemoryMax=64G -p MemorySwapMax=0 -p TasksMax=4096 --unit=${CG}-$RANDOM --`;
const HARD = `**HARD RULES:** Work ONLY in ${WT} on branch claude/phase-g-tswarm-s${SHARD}. REAL fixes from .zig spec, NOT stubs/suppressions.

**NO NEW \`unsafe {}\` outside FFI.** If you reach for \`unsafe { &mut *ptr }\` / \`unsafe { &*ptr }\` / \`unsafe { ptr.cast().as_ref() }\`:
- Change the fn signature to take \`&mut T\`/\`&T\` and let the (one) caller do the deref — or better, find why the caller has a raw ptr at all.
- Raw-ptr field on a struct → add a safe accessor on the struct, not per-call-site unsafe.
- Genuine FFI (\`extern "C"\` call into C++/libuv/uws) → OK, with SAFETY comment.
- After your fix: \`git diff HEAD~1 -- 'src/' | grep -c '^+.*unsafe {'\` must be ≤ FFI-call count. Reviewers REJECT otherwise.

Never git reset/checkout/stash/rebase/pull. **Commit explicit paths only:** \`git -c core.hooksPath=/dev/null add 'src/' Cargo.toml Cargo.lock && git commit -q -m "..."\` — never \`git add -A\`. NO push (orchestrator merges).`;

let history = [];

// ── Isolate (once) ──
phase("Isolate");
const iso = await agent(
  `Set up isolated shard ${SHARD}.

1. **Worktree:** \`test -d ${WT} || git -C /root/bun-5 worktree add -b claude/phase-g-tswarm-s${SHARD} ${WT} claude/phase-a-port\`. **Own build/ + target/** (NO symlinks — full isolation): \`mkdir -p ${WT}/build/debug ${WT}/target\`. Seed shared C++ obj + codegen (read-only copies, ~1GB): \`rsync -a --exclude='bun-debug*' --exclude='*.tmp*' /root/bun-5/build/debug/ ${WT}/build/debug/\`.
2. **Build once:** \`cd ${WT} && ${RUN_IN_CG} bun bd --version 2>&1 | tail -3\` → must show version.
3. **cgroup test:** \`${RUN_IN_CG} true && echo cgroup_ok\`

Return {worktree_ok, cgroup_ok, build_ok, notes}.`,
  { label: `isolate-s${SHARD}`, phase: "Isolate", schema: ISOLATE_S },
);
if (!iso || !iso.worktree_ok || !iso.build_ok) return { error: "isolation failed", iso };

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey test files in **isolated worktree ${WT}** (cgroup ${CG}). Shard ${SHARD}/${NSHARDS} round ${round}.

1. \`cd ${WT}\`. List: \`ls ${TEST_GLOB}\`. Take every ${NSHARDS}th starting at ${SHARD}.
2. For each (in cgroup, timeout 30s): \`${RUN_IN_CG} timeout 30 bun bd test <file> 2>&1\`
3. Categorize: completing (exit 0/1, "X pass"), crashing (SIGSEGV/panic/ASAN/ASSERT — extract signature), hanging (timeout).
4. Dedup crash signatures.

Return {completing:[files], crashing:[{file,signature}], hanging:[files], total:N}. DO NOT edit src/.`,
    { label: `survey-s${SHARD}-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }

  log(`r${round}: ${survey.completing.length}/${survey.total} completing, ${survey.crashing.length} crashing`);
  if (survey.crashing.length === 0 && (survey.hanging || []).length === 0) {
    return {
      rounds: round,
      done: true,
      completing: survey.completing.length,
      total: survey.total,
      history,
      branch: `claude/phase-g-tswarm-s${SHARD}`,
    };
  }

  const sigs = {};
  for (const c of survey.crashing) {
    (sigs[c.signature] ||= []).push(c.file);
  }
  const unique = Object.entries(sigs)
    .map(([sig, files]) => ({ sig, files, sample: files[0] }))
    .slice(0, 12);

  await pipeline(
    unique,
    u =>
      agent(
        `Fix crash signature in **${WT}** (your isolated worktree). ${u.files.length} files hit:

**Signature:** ${u.sig}
**Sample:** \`cd ${WT} && ${RUN_IN_CG} bun bd test ${u.sample} 2>&1\`

1. Reproduce, full backtrace. 2. Root-cause from .zig spec. 3. Port REAL fix. 4. Re-run sample → must complete.

${HARD}

Return {signature:"${u.sig}", root_cause, files_touched, commit, notes}.`,
        { label: `fix:${u.sig.slice(0, 40)}`, phase: "Fix", schema: FIX_S },
      ),
    (fix, u) =>
      fix
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Review fix for "${u.sig}" in ${WT}. Diff: \`git -C ${WT} diff ${fix.commit}~1..${fix.commit}\`.

**Check:**
1. **NEW unsafe?** \`git -C ${WT} diff ${fix.commit}~1..${fix.commit} | grep '^+.*unsafe {'\` — for each: is it an FFI call (extern "C", uws::, libc::, JSC__)? If NOT → REJECT with fix="change signature to take &mut T / &T, push deref to caller".
2. Matches .zig spec? Real fix or suppression?
3. UB introduced?
4. \`cd ${WT} && bun bd test ${u.sample}\` completes?

accept:true ONLY if no non-FFI unsafe added + real fix + no UB + test completes. DO NOT edit.

Return {accept, bugs:[{file,what,fix,severity}]}.`,
                  { label: `rev${i}:${u.sig.slice(0, 30)}`, phase: "Review", schema: REVIEW_S },
                ),
            ),
          ).then(votes => {
            const bugs = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
            const accepted = (votes || []).filter(Boolean).length >= 2 && votes.every(v => v && v.accept);
            return { sig: u.sig, fix, accepted, bugs };
          })
        : null,
    (vr, u) =>
      vr && !vr.accepted && vr.bugs.length > 0
        ? agent(
            `Re-fix "${u.sig}" in ${WT} — review REJECTED.\n\n${vr.bugs.map((b, i) => `${i + 1}. [${b.severity}] ${b.file}: ${b.what}\n   FIX: ${b.fix}`).join("\n")}\n\nApply each. Re-run sample. Commit.\n\n${HARD}\n\nReturn {signature, root_cause, files_touched, commit, notes}.`,
            { label: `refix:${u.sig.slice(0, 30)}`, phase: "Fix", schema: FIX_S },
          )
        : vr,
  );

  history.push({ round, completing: survey.completing.length, total: survey.total, sigs: unique.length });
}

return { rounds: MAX_ROUNDS, done: false, history, branch: `claude/phase-g-tswarm-s${SHARD}` };
