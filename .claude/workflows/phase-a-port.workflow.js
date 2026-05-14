export const meta = {
  name: "phase-a-port",
  description: "Phase A: draft .rs for a batch of .zig files (implement → verify → fix)",
  phases: [
    { title: "Implement", detail: "one agent per .zig writes draft .rs per PORTING.md" },
    { title: "Verify", detail: "adversarial check of .rs against .zig + PORTING.md rules" },
    { title: "Fix", detail: "apply verifier findings to .rs" },
  ],
};

// args: { files: Array<{zig: string, loc: number}>, repo: string }
const REPO = (args && args.repo) || "/root/bun-5";
const GUIDE = `${REPO}/docs/PORTING.md`;

// Deterministic rs path (PORTING.md ground rules) — do NOT let agents pick.
function rsPathFor(zig) {
  const parts = zig.split("/");
  const file = parts.pop();
  const base = file.replace(/\.zig$/, "");
  const parent = parts[parts.length - 1];
  const area = parts[1];
  if (parts.length === 2 && base === area) return [...parts, "lib.rs"].join("/");
  if (base === parent) return [...parts, "mod.rs"].join("/");
  return [...parts, base + ".rs"].join("/");
}
const FILES = ((args && args.files) || []).map(f => ({ ...f, rs: rsPathFor(f.zig) }));

if (FILES.length === 0) return { error: "no files in args.files" };
log(`batch: ${FILES.length} files, ${FILES.reduce((a, f) => a + f.loc, 0)} zig LOC total`);

const IMPL_SCHEMA = {
  type: "object",
  required: ["rs_path", "confidence", "todos", "rs_loc"],
  properties: {
    rs_path: { type: "string", description: "absolute path of the .rs file you wrote" },
    confidence: { enum: ["high", "medium", "low"] },
    todos: { type: "integer" },
    rs_loc: { type: "integer" },
    skipped: { type: "boolean", description: "true only if file is generated and you wrote a 3-line stub" },
    note: { type: "string", description: "one line for Phase B, same as trailer notes" },
  },
};

const VERIFY_SCHEMA = {
  type: "object",
  required: ["ok", "issues"],
  properties: {
    ok: { type: "boolean", description: "true if no MUST-FIX issues found" },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["rule", "detail", "severity"],
        properties: {
          rule: { type: "string", description: 'PORTING.md section or rule violated, e.g. "Idiom map: @intCast"' },
          detail: { type: "string", description: "what is wrong and where (fn name or approx line)" },
          fix: { type: "string", description: "exact correction to apply" },
          severity: { enum: ["must-fix", "should-fix", "nit"] },
        },
      },
    },
  },
};

const FIX_SCHEMA = {
  type: "object",
  required: ["applied", "remaining"],
  properties: {
    applied: { type: "integer" },
    remaining: { type: "integer", description: "must-fix issues you could not resolve" },
    note: { type: "string" },
  },
};

const implementPrompt = f =>
  `
You are a Phase-A porting agent. Your ONLY job: translate one Zig file to a draft Rust file.

1. Read ${GUIDE} — the porting guide. Read the WHOLE file. Every rule is load-bearing.
2. Run: \`grep "^${f.zig}\\b" ${REPO}/docs/LIFETIMES.tsv\` — these are the pre-classified Rust types for every *T/?*T struct field in this file (cols: file, struct, field, zig_type, class, rust_type, evidence). Use the rust_type column verbatim for those fields. If no rows match, this file has no pointer struct fields.
3. Read ${REPO}/${f.zig} (${f.loc} lines).${f.loc > 1800 ? ` This may exceed Read's default — Read in segments (offset/limit) to get the WHOLE file.` : ""}
4. Write the .rs to EXACTLY this path: ${REPO}/${f.rs}
   (Do not pick a different path. Do not "follow" re-exports to another file.)${
     f.loc > 1000
       ? `
   **CHUNKED WRITE — HARD REQUIREMENT** (${f.loc}-LOC source). The harness kills any tool call that emits >180s of tokens. You MUST write in chunks of ≤800 lines:
   - First: Write the first ~800 lines (stop at a fn/impl boundary).
   - Then loop: Edit with old_string = the EXACT last 2 lines you just wrote, new_string = those 2 lines + the next ~800 lines. Repeat.
   - Final chunk includes the PORT STATUS trailer.
   NEVER emit more than ~800 lines in any single Write or Edit. If you try, you will be killed and retried — wasting tokens.`
       : ""
   }
5. Match structure, fn names (snake_case), field order, control flow. End with the PORT STATUS trailer.
6. Return structured output with rs_path set to that exact path.

If ${f.zig} is a thin re-export (\`pub const X = @import("./other.zig").X;\`), port it as a thin re-export (\`pub use ...::X;\`). Do NOT inline the target's body.

Do NOT read other .zig files "for context" — PORTING.md's crate/type maps are authoritative for cross-file refs. Do NOT run builds. Do NOT git anything.

If the file matches PORTING.md "Don't translate" generated-file list, write the 3-line stub and set skipped=true.
`.trim();

const verifyPrompt = (f, impl) =>
  `
You are an adversarial Phase-A verifier. Find every place the draft .rs DEVIATES from PORTING.md.

1. Read ${GUIDE}.
2. Read ${REPO}/${f.zig} (source of truth for logic).
3. Read ${impl.rs_path} (the draft).

Check ONLY against PORTING.md rules. High-value targets:
- \`pub fn deinit(&mut self)\` instead of \`impl Drop\` (or kept body that only frees owned fields)
- \`comptime T: type\` ported as const generic instead of plain \`<T>\`
- \`&dyn Allocator\` param outside AST crates, or \`bun_collections::List\` anywhere (non-AST: Vec<T> + drop param; AST: bumpalo::collections::Vec<'bump,T> + &'bump Bump)
- \`String\`/\`&str\`/\`from_utf8\`/\`.to_string()\` for data (paths, source, headers) — must be \`Vec<u8>\`/\`&[u8]\`/\`Box<[u8]>\`; \`bstr\` for ops
- \`[]const u8\` struct field as \`&[u8]\` when this file's deinit frees it (should be \`Box<[u8]>\`)
- \`?*T\` field type that contradicts docs/LIFETIMES.tsv entry for this struct (if entry exists)
- \`errdefer x.deinit()\` on owned local kept (should be deleted)
- \`anyhow::Error\` / \`Box<dyn Error>\` (should be \`bun_core::Error\` NonZeroU16)
- \`ComptimeStringMap\` not ported to \`phf::phf_map!\` or match
- bare \`as\` for narrowing cast (must be \`T::try_from(x).unwrap()\`)
- Vec<JSValue> / JSValue stored in Box/Arc field
- std::collections::HashMap / std::fs / std::net / std::path / async fn / tokio
- missing \`// SAFETY:\` on unsafe blocks
- *_jsc alias lines kept instead of deleted
- dropped logic / missing fns vs the .zig

Do NOT flag: imports that won't resolve yet, lifetimes, things PORTING.md explicitly defers to Phase B.
Default to ok=false if you find ANY must-fix. Be specific: name the fn and the exact wrong→right.
If impl.skipped=true and the stub looks right, return ok=true, issues=[].
`.trim();

const fixPrompt = (f, impl, ver) =>
  `
You are a Phase-A fixer. Apply verifier findings to the draft .rs. Nothing else.

1. Read ${GUIDE} (skim — you need the rules the issues cite).
2. Read ${impl.rs_path}.
3. Read ${REPO}/${f.zig} ONLY if an issue says logic was dropped.
4. Apply each must-fix and should-fix below using Edit. Update the PORT STATUS trailer (todos count, confidence).

Issues (JSON):
${JSON.stringify(ver.issues, null, 2)}

Do NOT rewrite the whole file. Surgical edits only. If an issue is wrong (verifier hallucinated), skip it and note in output.
`.trim();

const results = await pipeline(
  FILES,
  // ── Implement ──
  f =>
    agent(implementPrompt(f), {
      label: `impl:${f.zig.replace(/^src\//, "")}`,
      phase: "Implement",
      schema: IMPL_SCHEMA,
    }),
  // ── Verify ──
  (impl, f) => {
    if (!impl) return { ok: false, issues: [], _impl: null, _skip: true };
    impl.rs_path = `${REPO}/${f.rs}`; // canonical, ignore what impl claimed
    return agent(verifyPrompt(f, impl), {
      label: `verify:${f.zig.replace(/^src\//, "")}`,
      phase: "Verify",
      schema: VERIFY_SCHEMA,
    }).then(v => ({ ...v, _impl: impl }));
  },
  // ── Fix ──
  (ver, f) => {
    const impl = ver && ver._impl;
    if (!impl) return { file: f.zig, status: "impl-failed" };
    if (ver._skip)
      return {
        file: f.zig,
        rs: impl.rs_path,
        status: "verify-skipped",
        confidence: impl.confidence,
        todos: impl.todos,
      };
    const mustFix = (ver.issues || []).filter(i => i.severity !== "nit");
    if (mustFix.length === 0) {
      return {
        file: f.zig,
        rs: impl.rs_path,
        status: "clean",
        confidence: impl.confidence,
        todos: impl.todos,
        rs_loc: impl.rs_loc,
        skipped: !!impl.skipped,
      };
    }
    return agent(fixPrompt(f, impl, { issues: mustFix }), {
      label: `fix:${f.zig.replace(/^src\//, "")}`,
      phase: "Fix",
      schema: FIX_SCHEMA,
    }).then(fx => ({
      file: f.zig,
      rs: impl.rs_path,
      status: "fixed",
      confidence: impl.confidence,
      todos: impl.todos,
      rs_loc: impl.rs_loc,
      issues_found: mustFix.length,
      applied: fx ? fx.applied : 0,
      remaining: fx ? fx.remaining : mustFix.length,
      skipped: !!impl.skipped,
    }));
  },
);

const ok = results.filter(r => r && (r.status === "clean" || r.status === "fixed"));
const failed = results.filter(r => !r || r.status === "impl-failed");
log(`done: ${ok.length}/${FILES.length} ok, ${failed.length} impl-failed`);

return {
  total: FILES.length,
  clean: results.filter(r => r && r.status === "clean").length,
  fixed: results.filter(r => r && r.status === "fixed").length,
  failed: failed.map(r => r && r.file).filter(Boolean),
  by_confidence: {
    high: ok.filter(r => r.confidence === "high").length,
    medium: ok.filter(r => r.confidence === "medium").length,
    low: ok.filter(r => r.confidence === "low").length,
  },
  results,
};
