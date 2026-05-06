export const meta = {
  name: "phase-e-proper-port",
  description:
    "PROPER port: per-file, real .zig bodies, NO todo!/gate/stub, mandatory 2-vote verify with reject→report, idiomatic Rust.",
  phases: [
    { title: "Survey", detail: "find files with slop (todo!/unimplemented!/gate/draft-mod) OR compile errors" },
    { title: "Port", detail: "one agent per file: REAL bodies from .zig, port upstream transitively" },
    { title: "Verify", detail: "2 adversarial reviewers vs .zig spec — reject if any todo!/divergence" },
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
**LAYERING IS THE ROOT FIX (do this FIRST, not last):**
Most \`todo!("blocked_on: X")\` exist because crate A needs symbol X from crate B but B depends on A. The fix is NOT a stub — it's MOVING X (or its type) to a crate both depend on.

Step 0 (before porting any fn body): identify WHY the symbol is unreachable.
- **Symbol exists in higher-tier crate** (e.g. runtime/ needs jsc/ symbol but jsc/ depends on runtime/): MOVE the type/fn to a shared lower crate. Common targets: bun_core, bun_jsc (if no runtime dep), or a new bun_<feature>_types crate. Update both crates' imports. This is the WORK.
- **Symbol exists in same-tier sibling** (e.g. http_jsc needs sql_jsc type): both should depend on the type via a lower crate, OR pass it as a parameter/vtable.
- **Symbol genuinely doesn't exist yet** (.zig has it, .rs doesn't): PORT it to where the .zig version lives.
- **Type is used opaquely** (only as \`*mut T\`, never deref'd): use \`*mut c_void\` + a typed-pointer newtype in the lower crate.

NEVER: local extern "C" shim that re-declares the symbol, opaque ZST stub structs ("opaque_default!"), trait-with-unimplemented-default. These are all layering workarounds.
`;

const BANS = `${LAYERING}
**BANNED (will be rejected by verify):**
- \`todo!()\` / \`unimplemented!()\` / \`unreachable!("stub")\` — ZERO tolerance. Port the real body.
- \`#[cfg(any())]\` / \`#![cfg(any())]\` / \`mod _gated\` / \`mod phase_a_draft\` — ZERO tolerance.
- \`&self as *const _ as *mut _\` → \`&mut\` casts (UB). Use \`*mut Self\` receiver or \`&mut self\`.
- \`Box::leak\` / \`mem::forget\` for \`&'static\`. Use proper ownership.
- \`let _ = result;\` swallowing errors. Propagate or handle per .zig spec.
- Transliterated Zig (\`@intCast\`-style casts everywhere). Write idiomatic Rust.

**REQUIRED:**
- Match .zig semantics: control flow, error paths, side effects, allocation/free pairing.
- Missing upstream symbol → port it in its file (from its .zig). Transitively. Do NOT defer.
- Dep cycle → move type to lower crate (per docs/PORTING.md).
- Use docs/PORTING.md conventions (bun.* APIs, Maybe<T>, etc).
`;

const HARD = `**HARD RULES:** ${BANS}\nNever git reset/checkout/stash/rebase/pull. Never edit .zig. Commit only: \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-e(port): <file>"\`. NO push.`;

let history = [];
for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase("Survey");
  const survey = await agent(
    `Survey: find ALL files with slop OR compile errors. Repo /root/bun-5. Shard ${SHARD}/${NSHARDS} round ${round}.

1. Slop scan: \`grep -rln 'todo!(\\|unimplemented!(\\|#\\[cfg(any())\\]\\|#!\\[cfg(any())\\]\\|mod phase_a_draft\\|mod _phase_a_draft\\|mod _jsc_gated\\|mod _gated' src/ --include='*.rs'\` → for each file, count each pattern. EXCLUDE build/debug/codegen/ (those are generated).
2. Compile errors: \`cargo check --workspace --keep-going > /tmp/pp-s${SHARD}-r${round}.log 2>&1\`; per-file: \`grep -oP '\\-\\-> \\Ksrc/[^:]+\\.rs' | sort | uniq -c\`
3. total_slop = sum of (todos+unimpls+gates+has_draft). total_errs = grep -c '^error'.

Return {files:[{file,todos,unimpls,gates,has_draft,compile_errs}], total_slop, total_errs}. DO NOT edit src/.`,
    { label: `survey-s${SHARD}-r${round}`, phase: "Survey", schema: SURVEY_S },
  );
  if (!survey) {
    history.push({ round, error: "survey failed" });
    continue;
  }
  if (survey.total_slop === 0 && survey.total_errs === 0) return { rounds: round, done: true, history };

  // Prioritize: compile_errs first (cascade), then slop count
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
    // Stage 1: Port
    f =>
      agent(
        `Port **${f.file}** PROPERLY by FIXING LAYERING. Repo /root/bun-5 @ HEAD.\n\nState: ${f.compile_errs || 0} compile errors, ${f.todos || 0} todo!(), ${f.unimpls || 0} unimplemented!(), ${f.gates || 0} gates${f.has_draft ? ", has phase_a_draft mod" : ""}.\n\n**Process:**\n0. **LAYERING DIAGNOSIS FIRST:** For each todo!/unimplemented!/compile-error, identify: is this a dep-cycle (symbol in wrong crate)? If yes, the fix is MOVING the type/fn, not stubbing. Read docs/PORTING.md §Layering. Record each move in layering_moves.\n1. Read ${f.file} + .zig spec at same path.\n2. ${f.has_draft ? "**Dissolve phase_a_draft mod**: replace top-level stubs with draft impls, delete wrapper, dedup." : ""}\n3. For EVERY \`todo!()\`/\`unimplemented!()\`: if blocked on dep-cycle → MOVE the blocking type/fn to a lower crate (do the move, update imports in both crates). Then port the FULL body from .zig.\n4. Missing upstream symbol (no cycle) → port it in its .rs file from its .zig. Transitively.\n5. Fix compile errors by REAL fixes. Never opaque-stub a type to break a cycle — MOVE it.\n6. After: \`grep -c 'todo!(\\|unimplemented!(\\|#\\[cfg(any())\\]\\|phase_a_draft\\|opaque_default!\\|stub_ty!' ${f.file}\` → MUST be 0.\n7. \`cargo check -p <crate>\` → 0 errors in your file.\n8. Commit.\n\n${HARD}\n\nReturn {file:"${f.file}", ported_fns:[...], upstream_added:[...], layering_moves:[{what,from,to,why}], draft_dissolved:bool, slop_after:N, notes}.`,
        { label: `port:${f.file.replace("src/", "")}`, phase: "Port", schema: PORT_S },
      ),
    // Stage 2: 2-vote Verify
    (port, f) =>
      port
        ? parallel(
            [0, 1].map(
              i => () =>
                agent(
                  `Adversarially verify **${f.file}** against .zig spec. Repo /root/bun-5 @ HEAD.\n\nPorter claims: ${(port.ported_fns || []).length} fns ported, slop_after=${port.slop_after}.\n\n**Check:**\n1. \`grep -n 'todo!(\\|unimplemented!(\\|#\\[cfg(any())\\]\\|phase_a_draft' ${f.file}\` — if ANY → REJECT (accept:false, slop_found:N).\n2. For each fn in ported_fns: read .rs body + .zig body. Find: spec divergences, wrong error handling, missed match arms, off-by-ones, alloc/free mismatch, swallowed errors, UB casts, missing side effects.\n3. Is it idiomatic Rust (proper ownership, ?-propagation, iterators) or transliterated Zig?\n\n**accept:true** ONLY if slop_found==0 AND no severity:"logic-bug" findings. Else accept:false.\n\nDEFAULT to accept:true if genuinely clean. DO NOT edit. DO NOT run cargo.\n\nReturn {file:"${f.file}", accept:bool, bugs:[{fn,what,fix,severity}], slop_found:N}.`,
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
    // Stage 3: Re-port if rejected
    (vr, f) =>
      vr && !vr.accepted
        ? agent(
            `RE-PORT **${f.file}** — verify REJECTED. Repo /root/bun-5 @ HEAD.\n\n**Reviewer findings (${vr.bugs.length} bugs, slop_found=${vr.slop}):**\n${vr.bugs.map((b, i) => `${i + 1}. **${b.fn}** [${b.severity || "bug"}]: ${b.what}\n   FIX: ${b.fix}`).join("\n")}\n${vr.slop > 0 ? `\n${vr.slop} todo!/unimplemented!/gate STILL PRESENT — port them.` : ""}\n\nApply each fix. Re-port any remaining slop. Commit.\n\n${HARD}\n\nReturn {file:"${f.file}", ported_fns:[...], upstream_added:[...], slop_after:N, notes}.`,
            { label: `report:${f.file.replace("src/", "")}`, phase: "Report", schema: PORT_S },
          )
        : vr,
  );

  history.push({ round, slop: survey.total_slop, errs: survey.total_errs, mine: mine.length });
}
return { rounds: MAX_ROUNDS, done: false, history };
