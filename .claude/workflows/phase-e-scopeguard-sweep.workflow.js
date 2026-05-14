export const meta = {
  name: "phase-e-scopeguard-sweep",
  description: "Replace scopeguard::guard((), |_|...) defer-transliterations with proper RAII (Drop, MutexGuard, etc).",
  phases: [
    { title: "Survey", detail: "find all scopeguard::guard((), ...) sites" },
    { title: "Fix", detail: "per-file: convert to RAII per docs/PORTING.md L152" },
    { title: "Verify", detail: "2-vote: check no unit-state guards remain + RAII is correct" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 10;
const SHARD = (args && args.shard) || 0;
const NSHARDS = (args && args.nshards) || 1;

const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, n: { type: "number" } },
        required: ["file", "n"],
      },
    },
    total: { type: "number" },
  },
  required: ["files", "total"],
};
const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    converted: { type: "number" },
    raii_types_added: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
  required: ["file", "converted"],
};
const VERIFY_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    accept: { type: "boolean" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: { fn: { type: "string" }, what: { type: "string" }, fix: { type: "string" } },
        required: ["fn", "what"],
      },
    },
    remaining: { type: "number" },
  },
  required: ["file", "accept", "remaining"],
};

const RULE = `
**Per docs/PORTING.md L152 — \`scopeguard::guard((), |_| ...)\` is BANNED:**
- \`Output::flush()\` defer → make the buffered writer impl \`Drop\` and flush itself, OR call flush at fn end if no early returns.
- \`lock.unlock()\` defer → the lock should return a \`MutexGuard\` (drop unlocks). Fix \`bun_core::Mutex::lock()\` to return a guard if it doesn't.
- \`x.deref()\` / refcount defer → wrap in an RAII owner (the type should impl Drop, or use \`bun_ptr::RefPtr<T>\`).
- \`arena.reset()\` defer → arena should be a scoped local that resets on Drop.
- Genuinely one-off → \`scopeguard::defer! { ... }\` macro (NOT \`guard((), |_| ...)\`).
- \`scopeguard::guard(state, |s| ...)\` with NON-unit state for errdefer rollback is OK (disarmed via \`into_inner\` on success).
`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey: count \`scopeguard::guard((), \` per file. Repo /root/bun-5.

\`grep -rn 'scopeguard::guard((), ' src/ --include='*.rs' | grep -oP '^[^:]+' | sort | uniq -c | sort -rn\`

Return {files:[{file,n}], total}. DO NOT edit.`,
    { label: `survey-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey || survey.total === 0) return { rounds: round, done: true, history };

  const sorted = survey.files.filter(f => f.n > 0).sort((a, b) => b.n - a.n);
  const mine = sorted.filter((_, i) => i % NSHARDS === SHARD).slice(0, 16);
  log(`r${round}: ${survey.total} unit-state guards, ${mine.length}/${sorted.length} files`);
  if (mine.length === 0) return { rounds: round, done: false, history };

  await pipeline(
    mine,
    f =>
      agent(
        `Convert ${f.n} \`scopeguard::guard((), |_| ...)\` in **${f.file}** to proper RAII. Repo /root/bun-5 @ HEAD.

${RULE}

**Process:**
1. Read ${f.file} + .zig spec. For each \`scopeguard::guard((), |_| X)\`:
   - Identify what X does (flush/unlock/deref/reset/custom).
   - Apply the matching RAII pattern. If it requires adding \`impl Drop\` to a type in another file, DO IT.
2. After: \`grep -c 'scopeguard::guard((), ' ${f.file}\` → MUST be 0.
3. \`cargo check -p <crate>\` → 0 errors.
4. Commit: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-e(raii): ${f.file}"\`. NO push.

Return {file:"${f.file}", converted:N, raii_types_added:[...], notes}.`,
        { label: `raii:${f.file.replace("src/", "")}`, phase: "Fix", schema: FIX_S },
      ),
    (fix, f) =>
      fix && fix.converted > 0
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Verify RAII conversion in **${f.file}**. Repo /root/bun-5 @ HEAD.

Porter claims ${fix.converted} converted, RAII types: ${(fix.raii_types_added || []).join(", ")}.

**Check:**
1. \`grep -c 'scopeguard::guard((), ' ${f.file}\` → if >0 REJECT.
2. For each conversion: does Drop fire on ALL paths (early return, ?, panic)? Is the cleanup semantically equivalent to the Zig defer?
3. New Drop impls correct (no double-free, no leak)?

Return {file:"${f.file}", accept:bool, bugs:[{fn,what,fix}], remaining:N}.`,
                  { label: `verify${i}:${f.file.replace("src/", "")}`, phase: "Verify", schema: VERIFY_S },
                ),
            ),
          ).then(vs => ({ file: f.file, fix, accepted: (vs || []).filter(Boolean).every(v => v.accept) }))
        : null,
  );

  history.push({ round, total: survey.total, mine: mine.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
