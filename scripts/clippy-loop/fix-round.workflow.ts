export const meta = {
  name: "clippy-fix-round",
  description: "Per-file clippy fixer with 2-reviewer adversarial gate",
  phases: [
    { title: "Fix", detail: "one read-only agent per file produces a unified diff" },
    { title: "Review", detail: "2 adversarial reviewers per diff; both must approve" },
  ],
};

// args: { round: number, files: Array<{file: string, count: number, diagnostics: Array<{code,message,line,col,rendered}>}> }
const round: number = args.round;
const files: Array<{
  file: string;
  count: number;
  diagnostics: Array<{ code: string; message: string; line: number; col: number; rendered: string }>;
}> = args.files;

const PATCH_SCHEMA = {
  type: "object",
  required: ["patch", "summary"],
  properties: {
    patch: {
      type: "string",
      description:
        "Unified diff (git apply compatible) against the repo root. Must use 'a/<path>' and 'b/<path>' headers and at least 3 lines of context. Empty string if no safe fix is possible.",
    },
    summary: { type: "string", description: "One line per lint addressed, or why a lint was left alone." },
    skipped: {
      type: "array",
      items: { type: "string" },
      description: "Lint codes intentionally not fixed and why (one entry each).",
    },
  },
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: "object",
  required: ["approved", "notes"],
  properties: {
    approved: { type: "boolean" },
    notes: { type: "string", description: "Concrete defects found, or 'ok'. Be specific: line, what's wrong, why." },
    revisedPatch: {
      type: "string",
      description:
        "Optional: a corrected unified diff if the original had a fixable defect. Same format rules as the fixer. Omit if approved or if the only correct action is to drop the patch.",
    },
  },
  additionalProperties: false,
};

const FIXER_RULES = `
HARD CONSTRAINTS — violating any of these means your output is discarded:
- You may use ONLY the Read and Grep tools. You are FORBIDDEN from using Bash, Edit, Write, git, cargo, or any tool that mutates state. Do not build, do not run tests.
- Return your change ONLY as a unified diff in the structured output. Do not apply it.
- The diff MUST apply cleanly with \`git apply --unidiff-zero\` from repo root: headers \`--- a/<path>\` / \`+++ b/<path>\`, @@ hunks with ≥3 context lines, exact whitespace.
- Touch ONLY the file you were assigned. Do not modify other files.
- NEVER silence a lint with #[allow(...)] unless the code is correct-as-is and the lint is a false positive — and then say why in \`skipped\`.
- NEVER weaken behavior to satisfy a lint (e.g. don't drop a mem::forget without replacing it with the equivalent ManuallyDrop/into_raw; don't make a fn \`unsafe\` if callers in other files would break — leave it and note in \`skipped\`).
- NEVER add comments other than \`// SAFETY:\` justifications.
- Prefer the smallest correct diff. Do not reformat unrelated lines.

LINT-SPECIFIC GUIDANCE:
- undocumented_unsafe_blocks: add a \`// SAFETY: <reason>\` immediately above the \`unsafe {\`. The reason must state the invariant, not restate the code. Read surrounding code to find the invariant.
- mem_forget: replace with ManuallyDrop where the value is later reclaimed, or \`Box::into_raw\`/\`Arc::into_raw\` for FFI handoff. If neither applies and the forget is intentional process-lifetime, use \`#[allow(clippy::mem_forget)]\` with a one-line reason in \`skipped\`.
- not_unsafe_ptr_arg_deref: if the fn is only called from FFI/generated code, mark it \`unsafe fn\` and add \`// SAFETY:\` at call sites IF they're in the same file. If callers are elsewhere, leave it and note in \`skipped\`.
- mut_from_ref: do NOT attempt to fix — add \`#[allow(clippy::mut_from_ref)]\` only if missing; this needs the bun_ptr::Cell refactor (separate PR).
- cast_ptr_alignment: use \`.cast::<T>()\` and \`read_unaligned()\` if the source may be misaligned; otherwise document alignment in SAFETY.
- or_fun_call / assigning_clones / trivially_copy_pass_by_ref / implicit_clone / unnecessary_unwrap / derivable_impls / derive_partial_eq_without_eq / clone_on_ref_ptr / vec_init_then_push / ptr_as_ptr family: apply clippy's suggested fix verbatim if it compiles by inspection.
- needless_pass_by_value / large_types_passed_by_value: change to borrow ONLY if you can see all callers are in this file or the fn is private. Public API: skip.
- disallowed_types / disallowed_methods / disallowed_macros: replace with the bun_* equivalent named in the lint message. If the replacement needs a new import, add it. If the bun_* API differs, skip and note.
- large_enum_variant / large_stack_frames: Box the offending arm/local. Skip if in a hot path you can't assess.
- todo / unimplemented / dbg_macro: skip and note — these need human triage.
`;

const REVIEWER_RULES = `
You are an ADVERSARIAL reviewer. Default stance: REJECT. Approve only if you cannot find a defect.
You may use ONLY Read and Grep. No Bash, no cargo, no git, no Edit/Write.

REJECT if ANY of:
- The diff would not compile (type mismatch, missing import, signature change breaks a caller you can find with Grep).
- The diff changes behavior (a dropped mem::forget that now double-frees; a fn made \`unsafe\` whose safe callers exist; an .unwrap_or → .unwrap_or_else that changes evaluation semantics observably).
- The diff silences a lint with #[allow] without a stated false-positive reason.
- The diff touches lines outside the reported lint locations without need.
- A SAFETY comment is vacuous ("SAFETY: this is safe") or wrong.
- Unified-diff format is malformed (bad headers, missing context, wrong line counts).

If you reject for a FIXABLE reason (typo, missing import, off-by-one context), provide \`revisedPatch\` with the corrected diff.
If you reject because the change is unsound or the lint should be skipped, leave \`revisedPatch\` empty.

Be terse. \`notes\` is for the apply step, not a human.
`;

function diagBlock(d: { code: string; line: number; rendered: string }[]) {
  return d.map(x => x.rendered.trimEnd()).join("\n\n");
}

const results = await pipeline(
  files,
  // ---- Fix ----
  f =>
    agent(
      `Fix the clippy errors in \`${f.file}\` (Bun repo, /root/bun-5).\n\n` +
        `There are ${f.count} target diagnostics in this file:\n\n` +
        "```\n" +
        diagBlock(f.diagnostics) +
        "\n```\n\n" +
        FIXER_RULES,
      { label: `fix:${f.file}`, phase: "Fix", schema: PATCH_SCHEMA },
    ),
  // ---- Review (2 adversarial, parallel) ----
  async (fix, f) => {
    if (!fix || !fix.patch?.trim()) {
      return { file: f.file, approved: false, patch: "", reviewNotes: fix?.summary ?? "fixer produced no patch" };
    }
    const reviewPrompt =
      `Adversarially review this clippy-fix diff for \`${f.file}\` (Bun repo, /root/bun-5).\n\n` +
      `Original diagnostics:\n\`\`\`\n${diagBlock(f.diagnostics)}\n\`\`\`\n\n` +
      `Proposed diff:\n\`\`\`diff\n${fix.patch}\n\`\`\`\n\n` +
      `Fixer's summary: ${fix.summary}\n\n` +
      REVIEWER_RULES;
    const [r1, r2] = await parallel([
      () => agent(reviewPrompt, { label: `rev1:${f.file}`, phase: "Review", schema: REVIEW_SCHEMA }),
      () => agent(reviewPrompt, { label: `rev2:${f.file}`, phase: "Review", schema: REVIEW_SCHEMA }),
    ]);
    const v1 = r1 ?? { approved: false, notes: "reviewer1 failed" };
    const v2 = r2 ?? { approved: false, notes: "reviewer2 failed" };
    // Both approve → ship fixer's patch.
    if (v1.approved && v2.approved) {
      return { file: f.file, approved: true, patch: fix.patch, reviewNotes: "2/2 approved" };
    }
    // One reviewer offered a revision and the other approved the original →
    // be conservative: drop (revisions aren't cross-reviewed this round).
    // Both reject → drop.
    const notes = [
      v1.approved ? "r1:ok" : `r1:REJECT ${v1.notes}`,
      v2.approved ? "r2:ok" : `r2:REJECT ${v2.notes}`,
    ].join(" | ");
    return { file: f.file, approved: false, patch: "", reviewNotes: notes };
  },
);

return results.filter(Boolean);
