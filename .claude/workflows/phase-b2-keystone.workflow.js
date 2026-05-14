export const meta = {
  name: "phase-b2-keystone",
  description: "Implement-from-spec keystone: implement → 2-vote adversarial verify vs spec → fix",
  phases: [
    { title: "Implement", detail: "one agent writes the implementation" },
    { title: "Verify", detail: "2-vote adversarial check vs .zig/.ts spec" },
    { title: "Fix", detail: "apply confirmed bugs" },
  ],
};
const REPO = "/root/bun-5";
// args: { task: string (the implement prompt), spec_files: ["src/x.zig", ...], verify_focus: string, edit_scope: ["src/x/", ...] }
const TASK = args.task;
const SPECS = args.spec_files || [];
const FOCUS = args.verify_focus || "logic correctness vs spec";
const SCOPE = (args.edit_scope || []).join(", ") || "the files you created";

if (!TASK) return { error: "args.task required" };

const IMPL_SCHEMA = {
  type: "object",
  required: ["files_touched", "notes"],
  properties: {
    files_touched: { type: "array", items: { type: "string" } },
    types_real: { type: "array", items: { type: "string" } },
    blocked_on: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};
const VERIFY_SCHEMA = {
  type: "object",
  required: ["bugs"],
  properties: {
    bugs: {
      type: "array",
      items: {
        type: "object",
        required: ["fn", "what", "fix"],
        properties: {
          fn: { type: "string" },
          what: { type: "string", description: "exact divergence: .rs does X, spec does Y, observable as Z" },
          fix: { type: "string" },
          severity: { enum: ["logic-bug", "incomplete", "nit"] },
        },
      },
    },
  },
};
const FIX_SCHEMA = {
  type: "object",
  required: ["fixed"],
  properties: { fixed: { type: "integer" }, notes: { type: "string" } },
};

phase("Implement");
const impl = await agent(
  `${TASK}\n\n**WE PORT ZIG, NOT C++.** If the .zig calls a C/C++ function (anything in WTF, JSC, BoringSSL, simdutf, highway, mimalloc, libarchive, lol-html, c-ares, lsquic, libuv, picohttp, ICU, etc.), declare \`extern "C" { fn X(...) }\` and CALL IT — the .a/.o files are already linked. NEVER re-implement a C/C++ library function in Rust. NEVER pull in a crates.io dep to replace something the C++ already does. \`grep -rn '<symbol>' src/jsc/bindings/ vendor/\` to find the C signature. The binding may already exist in a *_sys crate.\n\n**TOOLCHAIN:** Pinned nightly-2025-12-10. USE \`#![feature(..)]\` freely (adt_const_params, generic_const_exprs, inherent_associated_types, sync_unsafe_cell, ptr_metadata, etc.) instead of demoting to runtime args or stubbing. NEVER stub with "X is unstable" — enable the feature. NEVER leave \`unimplemented!()\`/\`todo!()\` in non-gated code citing a missing pattern when a macro or trait can solve it (e.g. per-type statics → declare-site macro).\n\n**HARD RULES:** Edit ONLY ${SCOPE}. Never .zig. **ABSOLUTE GIT BAN: NEVER run ANY git command** — not reset/checkout/stash/restore/clean/status. Other agents edit this tree concurrently; their broken files are EXPECTED. If cargo fails on a crate OUTSIDE your scope, IGNORE it — filter errors to YOUR files only. \`cargo check\` after each batch. Record absolute paths of every file you touched in files_touched.`,
  { label: "implement", phase: "Implement", schema: IMPL_SCHEMA },
);
if (!impl) return { error: "implement agent null" };
log(`implemented: ${impl.files_touched.length} files`);

phase("Verify");
const verifyPrompt = `Adversarially verify this implementation against its spec. You are looking for LOGIC bugs — places where the .rs does something DIFFERENT from the spec, not just type errors.

Spec files (read these as ground truth):
${SPECS.map(s => `- ${REPO}/${s}`).join("\n")}

Implementation files (read these and compare):
${impl.files_touched.map(f => `- ${f}`).join("\n")}

Focus: ${FOCUS}

Read ${REPO}/docs/PORTING.md §Forbidden patterns. Flag any Box::leak/mem::forget/transmute-to-enum/aliased-&mut/missing-match-arms/wrong-discriminants/silent-no-ops.

For each bug: cite the .rs line AND the spec line. Default to severity=logic-bug. Do NOT flag things gated behind #[cfg(any())] or todo!() — only live code.`;

const votes = await parallel([
  () => agent(verifyPrompt, { label: "verify-1", phase: "Verify", schema: VERIFY_SCHEMA }),
  () => agent(verifyPrompt, { label: "verify-2", phase: "Verify", schema: VERIFY_SCHEMA }),
]);
const allBugs = votes.filter(Boolean).flatMap(v => v.bugs);
// dedup by fn (keep first)
const seen = new Set();
const bugs = allBugs.filter(b => b.severity !== "nit" && !seen.has(b.fn) && seen.add(b.fn));
log(`verify: ${allBugs.length} raw → ${bugs.length} distinct`);

if (bugs.length === 0) return { impl, bugs: [], fixed: 0 };

phase("Fix");
const fix = await agent(
  `Apply these ${bugs.length} verified bugs to the implementation. Each has a concrete .fix from a 2-vote verifier.

Files to edit:
${impl.files_touched.map(f => `- ${f}`).join("\n")}

Bugs (JSON):
${JSON.stringify(bugs, null, 2)}

Read ${REPO}/docs/PORTING.md §Forbidden. Per bug: apply .fix via Edit. \`cargo check\` after. **HARD RULES:** Edit only the listed files. Never .zig. **ABSOLUTE GIT BAN: NEVER run ANY git command** — not reset/checkout/stash/restore/clean/status. Other agents edit this tree concurrently; their broken files are EXPECTED. If cargo fails on a crate OUTSIDE your scope, IGNORE it — filter errors to YOUR files only.`,
  { label: "fix", phase: "Fix", schema: FIX_SCHEMA },
);

return { impl, bugs, fixed: fix?.fixed ?? 0, blocked_on: impl.blocked_on || [] };
