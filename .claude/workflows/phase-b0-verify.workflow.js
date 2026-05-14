export const meta = {
  name: "phase-b0-verify",
  description:
    "Verify move-out/move-in edits per crate before commit: isolation, logic-preservation, vtable completeness",
  phases: [{ title: "Verify", detail: "one agent per modified crate reads git diff, flags issues" }],
};

const REPO = "/root/bun-5";
const CRATES = (args && args.crates) || []; // [{name}]
if (!CRATES.length) return { error: "no crates" };

const SCHEMA = {
  type: "object",
  required: ["ok", "issues"],
  properties: {
    ok: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "severity", "what"],
        properties: {
          file: { type: "string" },
          severity: { enum: ["block", "warn", "nit"] },
          what: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
    out_of_crate_files: { type: "array", items: { type: "string" } },
  },
};

phase("Verify");
const results = await pipeline(CRATES, c =>
  agent(
    `Verify B-0 move-out edits to crate **${c.name}** before commit. Adversarial — default to flagging.

1. \`git diff --name-only -- src/\` → list every modified file. Any NOT under \`src/${c.name}/\` that another verifier won't cover? (You only flag YOUR crate's expected boundary.) Actually simpler: \`git diff -- src/${c.name}/\` → that's your scope.
2. Read the diff: \`git diff -- ${REPO}/src/${c.name}/\`
3. Read \`${REPO}/docs/CYCLEBREAK.md\` §"\`${c.name}\`" + \`${REPO}/docs/PORTING.md\` §Dispatch (lines 352-415).
4. For each hunk, check:
   - **block**: a fn body was deleted/emptied that wasn't a pure dispatch-switch or alias re-export
   - **block**: a struct field was removed that held real data (not a variant-type ptr being replaced by \`*mut ()\`)
   - **block**: a new \`XxxVTable\` is missing a method the original \`union(enum)\` dispatched (compare to \`src/${c.name}/<file>.zig\`)
   - **block**: removed \`use bun_X::Y\` but \`Y\` still used in code (not comments)
   - **warn**: \`// SAFETY:\` removed without the \`unsafe {}\` also going
   - **warn**: tag+ptr conversion but no \`#[repr(transparent)]\` on the Tag newtype
   - **nit**: leftover commented-out code, redundant TODO

Read the matching .zig if you need to verify a vtable's method set. Do NOT edit anything. Return issues; ok=true only if zero block-severity.`,
    { label: `verify:${c.name}`, phase: "Verify", schema: SCHEMA },
  ).then(r => ({
    crate: c.name,
    ...(r || { ok: false, issues: [{ file: "?", severity: "block", what: "agent-null" }] }),
  })),
);

const blocked = results.filter(r => !r.ok);
return {
  crates: CRATES.length,
  ok: results.filter(r => r.ok).length,
  blocked: blocked.length,
  blocked_detail: blocked.map(r => ({ crate: r.crate, issues: r.issues.filter(i => i.severity === "block") })),
  warns: results.flatMap(r => r.issues.filter(i => i.severity === "warn").map(i => ({ crate: r.crate, ...i }))),
  results,
};
