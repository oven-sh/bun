export const meta = {
  name: "dead-code-edit-round",
  description: "Per-file direct-edit dead-code fixer + 1-reviewer gate",
  phases: [
    { title: "Edit", detail: "agent edits one file directly (no cargo/git/cross-file)" },
    { title: "Review", detail: "1 adversarial reviewer reads the diff" },
  ],
};

// args: Array<{file,count,diagPath}> or {files:[...]} or JSON string of either
const parsed = typeof args === "string" ? JSON.parse(args) : args;
const files = Array.isArray(parsed) ? parsed : parsed.files;
if (!Array.isArray(files)) throw new Error("args must yield an array of {file,count,diagPath}");

const RESULT_SCHEMA = {
  type: "object",
  required: ["status", "summary"],
  properties: {
    status: { type: "string", enum: ["fixed", "skipped", "partial"] },
    summary: { type: "string" },
  },
  additionalProperties: false,
};

const REVIEW_SCHEMA = {
  type: "object",
  required: ["verdict", "notes"],
  properties: {
    verdict: { type: "string", enum: ["ok", "revert", "fix-needed"] },
    notes: { type: "string" },
  },
  additionalProperties: false,
};

const FIXER = `
You are fixing dead-code/unused-* lints in ONE file in the Bun repo (/root/bun-5).

HARD RULES:
- Use ONLY Read, Grep, Edit. NEVER Bash, cargo, git, Write (use Edit for changes).
- Edit ONLY the file you are assigned. Do not touch any other file.
- Do NOT add #[allow(...)] (except: prefix a never-read field with _ on a #[repr(C)] struct).
- Do NOT change pub fn signatures (callers are in other files).

For each diagnostic:
- unused_imports: delete the import (or just the unused names from a use {a,b,c} group). If a trait import looks unused but provides methods (Grep for .method_name in this file), keep it as \`use X as _;\`.
- dead_code (fn/struct/const/static/type/trait/field never used): Grep the name across src/ first. If 0 hits outside this file, DELETE it. If it's #[no_mangle]/extern/used in a .classes.ts/macro, prefix with _ or note in summary. Never-read field on #[repr(C)]: prefix _.
- unused_variables / unused_mut: prefix _ or remove mut.
- unused_assignments: delete the dead initializer if all paths reassign before read; otherwise delete the trailing dead write.
- unreachable_code/patterns: delete the dead arm/statement. If reachable on another platform via #[cfg], wrap in matching cfg instead.
- unused_macros: delete the macro.
- unused_doc_comments: change /// to //.

CROSS-PLATFORM: each diagnostic in the dump is tagged \`[target1, target2, ...]\`. If a diagnostic only fires on non-host targets (e.g. \`[x86_64-pc-windows-msvc]\`), the item is USED on linux but unused/missing on that target — \`#[cfg(...)]\`-gate instead of deleting. If it fires on \`[host]\` AND a non-host target says "cannot find X" for the same name, the item is used only on that other target — \`#[cfg(that_target)]\`-gate the item.

Clippy lints:
- not_unsafe_ptr_arg_deref: mark the fn \`pub unsafe fn\` and add a \`/// # Safety\` doc stating the pointer precondition. Do NOT update Rust callers in OTHER files (they'll be picked up next round or by codegen regen). If the fn is \`#[no_mangle]\` / preceded by \`// HOST_EXPORT(...)\`, the C++ thunk wrapper handles it.
- mut_from_ref: do NOT change the signature. Add \`#[allow(clippy::mut_from_ref)]\` ONLY if the body goes through a raw pointer / UnsafeCell (note in summary). Otherwise skip.
- derivable_impls: replace the manual impl with \`#[derive(Default)]\` (or whichever trait) on the type.
- drop_non_drop: delete the \`drop(x)\` call (it's a no-op on a Copy type).
- large_enum_variant: \`Box<T>\` the large arm; update construction sites IN THIS FILE only.
- boxed_local / vec_box: skip and note (intentional pattern, lint is warn-level).
- manual_c_str_literals: \`b"...\\0"\` → \`c"..."\`.
- unnecessary_unwrap / clone_on_copy / useless_conversion / redundant_locals / ptr_eq / precedence / implicit_saturating_sub / manual_swap / mem_replace_option_with_none / question_mark / needless_borrow / redundant_closure / manual_is_ascii_check / unwrap_or_default / write_with_newline / unnecessary_cast / redundant_pattern_matching / match_like_matches_macro / extra_unused_type_parameters / for_kv_map / manual_find / field_reassign_with_default / never_loop / redundant_guards / multiple_bound_locations / needless_maybe_sized / assertions_on_constants / needless_borrows_for_generic_args: apply clippy's suggested rewrite verbatim.
- vec_init_then_push: replace \`let mut v = Vec::new(); v.push(a); v.push(b);\` with \`let v = vec![a, b];\`.
- E0308/E0277/E0425 etc. (compile errors from cross-platform or autofix damage): READ the error message and surrounding code; the fix is usually wrap in \`unsafe { }\`, add \`Box::new(...)\`, restore a deleted \`mut\`, or cfg-gate.
- unused_unsafe: delete the inner \`unsafe { }\` (the call inside is now safe, or there's an outer block).
- disallowed_types/methods/macros: replace with the bun_* equivalent named in the lint reason. If this file IS the bun_* wrapper, skip.

Prefer DELETING over gating. Be surgical.
`;

const REVIEWER = `
Adversarially review the edit. Use ONLY Read and Grep. No Bash/cargo/git/Edit.

Read /root/bun-5/<file> as it is NOW (post-edit). Compare against the diagnostics.

verdict:
- "ok" — every change addresses a listed diagnostic, nothing over-deleted, compiles by inspection.
- "revert" — agent broke something (deleted a used item, syntax error, removed a needed trait import). Be specific in notes.
- "fix-needed" — partially correct but left obvious issues; describe what.

Check specifically:
- Any deleted fn/struct/const: Grep its name in src/ — if hits exist outside this file, that's a "revert".
- Any removed import that provides trait methods used in this file: "revert".
`;

const results = await pipeline(
  files,
  f =>
    agent(
      `Fix the ${f.count} dead-code/unused diagnostics in \`/root/bun-5/${f.file}\`.\n` +
        `FIRST Read the diagnostics at \`${f.diagPath}\`.\n` +
        `THEN Read the file and apply fixes via Edit.\n\n` +
        FIXER,
      { label: `edit:${f.file}`, phase: "Edit", schema: RESULT_SCHEMA },
    ),
  async (edit, f) => {
    if (!edit) return { file: f.file, verdict: "skipped", notes: "fixer failed" };
    const review = await agent(
      `Review the dead-code fix to \`/root/bun-5/${f.file}\`.\n` +
        `Original diagnostics at \`${f.diagPath}\`.\n` +
        `Fixer's summary: ${edit.summary}\n\n` +
        REVIEWER,
      { label: `rev:${f.file}`, phase: "Review", schema: REVIEW_SCHEMA },
    );
    return { file: f.file, verdict: review?.verdict ?? "skipped", notes: review?.notes ?? "" };
  },
);

return results.filter(Boolean);
