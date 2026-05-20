#!/usr/bin/env bun
// Reads cargo clippy --message-format=json on stdin or argv[2], emits one JSON
// array of { file, count, diagnostics: [{code, message, line, col, rendered}] }
// sorted by count desc. Only includes lints we actually want fixed (the deny set
// in Cargo.toml + the deny-by-default correctness ones).

import { readFileSync } from "node:fs";

const TARGET_LINTS = new Set([
  // ptr provenance
  "clippy::ptr_as_ptr",
  "clippy::ptr_cast_constness",
  "clippy::ref_as_ptr",
  "clippy::borrow_as_ptr",
  // soundness / leaks
  "clippy::undocumented_unsafe_blocks",
  "clippy::not_unsafe_ptr_arg_deref",
  "clippy::mem_forget",
  "clippy::cast_ptr_alignment",
  "clippy::transmute_ptr_to_ptr",
  "clippy::as_ptr_cast_mut",
  "clippy::drop_non_drop",
  "clippy::uninit_vec",
  // perf
  "clippy::redundant_clone",
  "clippy::unnecessary_to_owned",
  "clippy::needless_collect",
  "clippy::or_fun_call",
  "clippy::assigning_clones",
  "clippy::implicit_clone",
  "clippy::iter_overeager_cloned",
  "clippy::map_clone",
  "clippy::trivially_copy_pass_by_ref",
  "clippy::large_types_passed_by_value",
  "clippy::large_enum_variant",
  "clippy::large_stack_frames",
  "clippy::vec_init_then_push",
  "clippy::format_collect",
  "clippy::manual_memcpy",
  "clippy::needless_pass_by_value",
  // clarity
  "clippy::unnecessary_unwrap",
  "clippy::derive_partial_eq_without_eq",
  "clippy::derivable_impls",
  "clippy::clone_on_ref_ptr",
  "clippy::if_same_then_else",
  "clippy::todo",
  "clippy::unimplemented",
  "clippy::dbg_macro",
  // disallowed
  "clippy::disallowed_methods",
  "clippy::disallowed_types",
  "clippy::disallowed_macros",
  // deny-by-default correctness that block downstream crates
  "clippy::useless_attribute",
  "clippy::absurd_extreme_comparisons",
  "clippy::mut_from_ref",
  // round 2: clarity / perf additions
  "clippy::clone_on_copy",
  "clippy::useless_conversion",
  "clippy::vec_box",
  "clippy::boxed_local",
  "clippy::arc_with_non_send_sync",
  "clippy::manual_swap",
  "clippy::mem_replace_option_with_none",
  "clippy::redundant_locals",
  "clippy::manual_c_str_literals",
  "clippy::precedence",
  "clippy::implicit_saturating_sub",
  "clippy::ptr_eq",
  // rustc lints (dead-code sweep)
  "dead_code",
  "unused_imports",
  "unused_variables",
  "unused_mut",
  "unused_assignments",
  "unused_macros",
  "unreachable_code",
  "unreachable_patterns",
  "unreachable_pub",
  "non_snake_case",
  "non_camel_case_types",
  "non_upper_case_globals",
  "unused_must_use",
  "unused_doc_comments",
  "unused_parens",
  "private_interfaces",
]);

const input = process.argv[2] ? readFileSync(process.argv[2], "utf8") : readFileSync(0, "utf8");

type Diag = { code: string; message: string; line: number; col: number; rendered: string };
const byFile = new Map<string, Diag[]>();

for (const line of input.split("\n")) {
  if (!line.startsWith("{")) continue;
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    continue;
  }
  if (msg.reason !== "compiler-message") continue;
  const m = msg.message;
  const code = m?.code?.code;
  if (!code) continue;
  // rustc emits deny-level lints with level "error"; clippy with "warning" under cap-lints
  if (!TARGET_LINTS.has(code)) continue;
  const primary = (m.spans ?? []).find((s: any) => s.is_primary) ?? m.spans?.[0];
  if (!primary) continue;
  const file = (primary.file_name as string).replaceAll("\\", "/");
  if (!file.startsWith("src/")) continue;
  const diag: Diag = {
    code,
    message: m.message,
    line: primary.line_start,
    col: primary.column_start,
    rendered: m.rendered ?? "",
  };
  const arr = byFile.get(file) ?? [];
  // dedupe (workspace builds can emit same diag once per dependent feature set)
  if (!arr.some(d => d.code === diag.code && d.line === diag.line && d.col === diag.col)) {
    arr.push(diag);
  }
  byFile.set(file, arr);
}

const out = [...byFile.entries()]
  .map(([file, diagnostics]) => ({ file, count: diagnostics.length, diagnostics }))
  .sort((a, b) => b.count - a.count);

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
