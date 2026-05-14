export const meta = {
  name: "phase-e-proper-port",
  description:
    "PROPER port: fix LAYERING first, real .zig bodies, NO todo!/gate/stub, mandatory 2-vote verify with reject→re-port.",
  phases: [
    { title: "Survey", detail: "find files with slop OR compile errors" },
    { title: "Port", detail: "LAYERING fix first, then real bodies from .zig" },
    { title: "Verify", detail: "2 reviewers reject layering-workarounds + slop + spec-divergence" },
    { title: "Report", detail: "if rejected, redo with reviewer feedback" },
  ],
};

const MAX_ROUNDS = (args && args.max_rounds) || 60;
const SHARD = (args && args.shard) || 0;
const NSHARDS = (args && args.nshards) || 1;

const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          todos: { type: "number" },
          unimpls: { type: "number" },
          has_draft: { type: "boolean" },
          gates: { type: "number" },
          compile_errs: { type: "number" },
        },
        required: ["file"],
      },
    },
    total_slop: { type: "number" },
    total_errs: { type: "number" },
  },
  required: ["files", "total_slop", "total_errs"],
};
const PORT_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    ported_fns: { type: "array", items: { type: "string" } },
    upstream_added: { type: "array", items: { type: "string" } },
    layering_moves: {
      type: "array",
      items: {
        type: "object",
        properties: {
          what: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          why: { type: "string" },
        },
        required: ["what", "from", "to"],
      },
    },
    draft_dissolved: { type: "boolean" },
    slop_after: { type: "number" },
    notes: { type: "string" },
  },
  required: ["file", "ported_fns", "slop_after"],
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
        properties: {
          fn: { type: "string" },
          what: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string" },
        },
        required: ["fn", "what", "fix"],
      },
    },
    slop_found: { type: "number" },
  },
  required: ["file", "accept", "bugs", "slop_found"],
};

const LAYERING = `
**LAYERING IS THE ROOT FIX (do this FIRST):**
Most \`todo!("blocked_on: X")\` exist because crate A needs symbol X from crate B but B depends on A (cycle). The fix is NOT a stub — it's MOVING X (or its type) to a crate both depend on.

Step 0 (before porting fn bodies): for each blocked symbol, identify WHY it's unreachable.
- **Symbol in higher-tier crate** (cycle): MOVE the type/fn to a shared lower crate. Common targets: bun_core, bun_jsc_types, bun_<feature>_types (create if needed). Update both crates' imports. THIS IS THE WORK.
- **Symbol in same-tier sibling**: extract shared type to lower crate, OR pass as parameter/generic/vtable.
- **Symbol genuinely doesn't exist** (.zig has it, .rs doesn't): PORT it where the .zig version lives.
- **Type used opaquely** (only \`*mut T\`, never deref'd): forward-declare via \`extern type\` or use the lower crate's typed-ptr newtype.

**LAYERING WORKAROUNDS (BANNED — verify rejects):**
- Local \`extern "C" { fn X }\` re-declaring a Rust symbol instead of importing it
- Opaque ZST stub structs (\`opaque_default!\`, \`stub_ty!\`, \`struct X { _opaque: () }\`) standing in for real types
- Trait-with-\`unimplemented!()\`-default to "satisfy" a missing impl
- vtable with null fn-ptrs
`;

const BANS = `${LAYERING}
**ALSO BANNED:**
- \`todo!()\` / \`unimplemented!()\` / \`unreachable!("stub")\` — ZERO. Port the real body.
- \`#[cfg(any())]\` / \`mod _gated\` / \`mod phase_a_draft\` — ZERO.
- \`&self as *const _ as *mut _\` → \`&mut\` casts (UB). Use \`*mut Self\` receiver or \`&mut self\`.
- \`Box::leak\` / \`mem::forget\` for \`&'static\`. Use proper ownership.
- \`let _ = result;\` swallowing errors. Propagate per .zig spec.
- Transliterated Zig. Write idiomatic Rust (ownership, ?-prop, iterators).

**REQUIRED:**
- Match .zig semantics exactly: control flow, error paths, side effects, alloc/free pairing.
- Use docs/PORTING.md conventions.
`;

const HARD = `**HARD RULES:**${BANS}\n**NEVER run cargo yourself** — read /tmp/cargo-check.log (daemon). Never git reset/checkout/stash/rebase/pull. Never edit .zig. Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-e(port): <file>"\`. NO push.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey: find ALL files with slop OR compile errors. Repo /root/bun-5. Shard ${SHARD}/${NSHARDS} round ${round}.

1. Slop scan: \`grep -rln 'todo!(\\|unimplemented!(\\|#\\[cfg(any())\\]\\|#!\\[cfg(any())\\]\\|mod phase_a_draft\\|mod _phase_a_draft\\|mod _jsc_gated\\|mod _gated\\|opaque_default!\\|stub_ty!' src/ --include='*.rs'\` → for each file count each pattern.
2. Compile errors: **DO NOT run cargo** — a daemon writes \`/tmp/cargo-check.log\` continuously. Read it: \`cat /tmp/cargo-check.log\`. Per-file: \`grep -oP '\\-\\-> \\Ksrc/[^:]+\\.rs' /tmp/cargo-check.log | sort | uniq -c\`. (If log missing or stale (\`/tmp/cargo-check.mtime\` > 120s old), fall back to \`cargo check --workspace --keep-going\` once.)
3. total_slop = sum(todos+unimpls+gates+has_draft). total_errs = grep -c '^error'.

Return {files:[{file,todos,unimpls,gates,has_draft,compile_errs}], total_slop, total_errs}. DO NOT edit src/.`,
    { label: `survey-s${SHARD}-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  if (survey.total_slop === 0 && survey.total_errs === 0) return { rounds: round, done: true, history };

  const sorted = survey.files
    .filter(f => (f.todos || 0) + (f.unimpls || 0) + (f.gates || 0) + (f.compile_errs || 0) > 0 || f.has_draft)
    .sort(
      (a, b) =>
        (b.compile_errs || 0) * 1000 +
        (b.todos || 0) +
        (b.unimpls || 0) -
        ((a.compile_errs || 0) * 1000 + (a.todos || 0) + (a.unimpls || 0)),
    );
  const mine = sorted.filter((_, i) => i % NSHARDS === SHARD).slice(0, 16);
  log(`r${round}: slop=${survey.total_slop} errs=${survey.total_errs} files=${sorted.length} mine=${mine.length}`);
  if (mine.length === 0) {
    history.push({ round, slop: survey.total_slop, errs: survey.total_errs, mine: 0 });
    continue;
  }

  await pipeline(
    mine,
    f =>
      agent(
        `Port **${f.file}** by FIXING LAYERING. Repo /root/bun-5 @ HEAD.

State: ${f.compile_errs || 0} compile errors, ${f.todos || 0} todo!(), ${f.unimpls || 0} unimplemented!(), ${f.gates || 0} gates${f.has_draft ? ", has phase_a_draft mod" : ""}.

**Process:**
0. **LAYERING DIAGNOSIS:** For each todo!/unimplemented!/error, ask: is this a dep-cycle (symbol in wrong crate)? If yes, MOVE the type/fn to a lower crate. Record in layering_moves.
1. Read ${f.file} + .zig spec at same path.
2. ${f.has_draft ? "**Dissolve phase_a_draft mod**: replace top-level stubs with draft impls, delete wrapper, dedup." : ""}
3. For EVERY \`todo!()\`/\`unimplemented!()\`: if blocked on cycle → DO THE MOVE first. Then port the FULL body from .zig.
4. Missing upstream symbol (no cycle) → port it in its .rs file from its .zig. Transitively.
5. Fix compile errors with REAL fixes. Never opaque-stub a type — MOVE it.
6. After: \`grep -c 'todo!(\\|unimplemented!(\\|#\\[cfg(any())\\]\\|phase_a_draft\\|opaque_default!\\|stub_ty!' ${f.file}\` → MUST be 0.
7. **DO NOT run cargo** — read \`/tmp/cargo-check.log\` (daemon-maintained). \`grep -A8 '\\-\\-> ${f.file}:' /tmp/cargo-check.log\` → if errors in YOUR file, fix them. The daemon refreshes every ~5-30s.
8. Commit.

${HARD}

Return {file:"${f.file}", ported_fns:[...], upstream_added:[...], layering_moves:[{what,from,to,why}], draft_dissolved:bool, slop_after:N, notes}.`,
        { label: `port:${f.file.replace("src/", "")}`, phase: "Port", schema: PORT_S },
      ),
    (port, f) =>
      port
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially verify **${f.file}** vs .zig spec + LAYERING. Repo /root/bun-5 @ HEAD.

Porter claims: ${(port.ported_fns || []).length} fns, ${(port.layering_moves || []).length} layering moves, slop_after=${port.slop_after}.

**REJECT (accept:false) if ANY:**
1. \`grep -n 'todo!(\\|unimplemented!(\\|#\\[cfg(any())\\]\\|phase_a_draft\\|opaque_default!\\|stub_ty!' ${f.file}\` >0.
2. **Layering workaround**: local \`extern "C"\` re-decl of Rust symbol, opaque ZST stub struct for a real type, trait-default-unimplemented, vtable-null-fn-ptrs. severity:"layering-workaround".
3. Spec divergence/wrong error handling/missed arm/alloc-free mismatch/swallowed error/UB cast. severity:"logic-bug".
4. Transliterated Zig. severity:"non-idiomatic".

For each layering_move: verify the type actually MOVED (check both files).

**accept:true** ONLY if slop_found==0 AND no layering-workaround AND no logic-bug. DO NOT edit/cargo.

Return {file:"${f.file}", accept:bool, bugs:[{fn,what,fix,severity}], slop_found:N}.`,
                  { label: `verify${i}:${f.file.replace("src/", "")}`, phase: "Verify", schema: VERIFY_S },
                ),
            ),
          ).then(votes => {
            const vs = (votes || []).filter(Boolean);
            const slop = Math.max(...vs.map(v => v.slop_found || 0), 0);
            const all = vs.flatMap(v => v.bugs || []);
            const k = {};
            const bugs = all.filter(b => {
              const key = `${b.fn}::${(b.what || "").slice(0, 60)}`;
              if (k[key]) return false;
              k[key] = 1;
              return true;
            });
            const accepted = vs.length >= 2 && vs.every(v => v.accept) && slop === 0;
            return { file: f.file, port, accepted, bugs, slop };
          })
        : null,
    (vr, f) =>
      vr && !vr.accepted
        ? agent(
            `RE-PORT **${f.file}** — verify REJECTED. Repo /root/bun-5 @ HEAD.

**Reviewer findings (${vr.bugs.length} bugs, slop_found=${vr.slop}):**
${vr.bugs.map((b, i) => `${i + 1}. **${b.fn}** [${b.severity || "bug"}]: ${b.what}\n   FIX: ${b.fix}`).join("\n")}
${vr.slop > 0 ? `\n${vr.slop} slop STILL PRESENT — port them.` : ""}

Apply each fix. If "layering-workaround" → DO THE MOVE. Re-port remaining slop. Commit.

${HARD}

Return {file:"${f.file}", ported_fns:[...], upstream_added:[...], layering_moves:[...], slop_after:N, notes}.`,
            { label: `report:${f.file.replace("src/", "")}`, phase: "Report", schema: PORT_S },
          )
        : vr,
  );

  history.push({ round, slop: survey.total_slop, errs: survey.total_errs, mine: mine.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
