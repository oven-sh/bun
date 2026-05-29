#!/usr/bin/env bun
// Remove every `//`-style comment block longer than 3 lines from tracked .rs
// files, except a block that is the first non-blank content in the file.
//
// "Comment block" = a maximal run of consecutive lines whose trimmed content
// starts with `//` (this covers `//`, `///`, and `//!`). Inline `/* ... */`
// annotations and trailing `// ...` after code are not comment-only lines and
// are never touched.
//
// Load-bearing comment lines/blocks are preserved:
//   - `// HOST_EXPORT(...)` markers (scraped by src/codegen/generate-host-exports.ts)
//     → the marker line is kept; surrounding prose in the same block is removed.
//   - `// SAFETY:` / `/// # Safety` blocks (clippy::undocumented_unsafe_blocks is
//     `deny` workspace-wide, Cargo.toml:216) → the entire block is kept.
//
// Usage:
//   bun scripts/strip-long-rs-comments.ts             # apply in-place to all tracked *.rs
//   bun scripts/strip-long-rs-comments.ts --dry       # report only
//   bun scripts/strip-long-rs-comments.ts --min N     # threshold (default 4)
//   bun scripts/strip-long-rs-comments.ts a.rs b.rs   # only these files (no git)

import { $ } from "bun";
import { readFileSync, writeFileSync } from "node:fs";

// Comment lines that must never be removed because codegen scrapes them.
// The matching line is kept; the rest of its block is still removed.
// Matched against the trimmed line.
const PROTECTED_LINE: RegExp[] = [
  /^\/\/\s*HOST_EXPORT\(/, // src/codegen/generate-host-exports.ts
];

// If any line in a block matches one of these, the entire block is kept.
// Matched against the trimmed line.
//
// `clippy::undocumented_unsafe_blocks` is `deny` workspace-wide (Cargo.toml)
// and accepts any comment containing /safety:/i immediately before `unsafe`.
// The tree uses many header variants — `// SAFETY:`, `// SAFETY (invariant):`,
// `// SAFETY CONTRACT:`, `/// # Safety`, `/// ## Safety` — so we keep any
// block that mentions SAFETY in caps, opens a line with a `Safety:`-style
// marker in any case, or carries a `/// # Safety` doc heading. Over-preserving
// a few prose blocks that merely reference the pattern is preferable to a
// clippy deny-error.
const PROTECTED_BLOCK: RegExp[] = [
  /\bSAFETY\b/, // `// SAFETY: ...`, `// SAFETY CONTRACT: ...`, any all-caps mention
  /^\/\/[/!]*\s*safety\s*:/i, // `// Safety: ...` / `// safety: ...` — clippy matches case-insensitively
  /^\/\/\/\s*#+\s*Safety\b/, // `/// # Safety` doc headings
];

// Hot-path helpers avoid .trim()/.trimStart() allocation — debug-build JS is
// slow enough that scanning ~3M lines with per-line temp strings takes 30s+.
function firstNonWs(line: string): number {
  let j = 0;
  const n = line.length;
  while (j < n) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) break; // space / tab
    j++;
  }
  return j;
}

function isCommentOnly(line: string): boolean {
  const j = firstNonWs(line);
  return line.charCodeAt(j) === 47 /* / */ && line.charCodeAt(j + 1) === 47 /* / */;
}

function isProtectedLine(line: string): boolean {
  const t = line.slice(firstNonWs(line));
  return PROTECTED_LINE.some(re => re.test(t));
}

function isProtectedBlockLine(line: string): boolean {
  const t = line.slice(firstNonWs(line));
  return PROTECTED_BLOCK.some(re => re.test(t));
}

function isBlank(line: string): boolean {
  return firstNonWs(line) === line.length;
}

export type Edit = { start: number; end: number }; // [start, end) line indices to delete

export function planEdits(lines: string[], min: number): Edit[] {
  // First non-blank line index, to identify the top-of-file block.
  let firstContent = 0;
  while (firstContent < lines.length && isBlank(lines[firstContent])) firstContent++;

  const raw: Edit[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isCommentOnly(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && isCommentOnly(lines[i])) i++;
    const end = i; // exclusive
    const len = end - start;
    const isTopOfFile = start === firstContent;
    if (len < min || isTopOfFile) continue;
    // Keep the whole block if any line in it is a SAFETY/# Safety justification.
    let keepBlock = false;
    for (let k = start; k < end; k++) {
      if (isProtectedBlockLine(lines[k])) {
        keepBlock = true;
        break;
      }
    }
    if (keepBlock) continue;
    // Split around protected single lines; keep those, drop the rest of the block.
    let segStart = start;
    for (let k = start; k <= end; k++) {
      const boundary = k === end || isProtectedLine(lines[k]);
      if (boundary) {
        if (k > segStart) raw.push({ start: segStart, end: k });
        segStart = k + 1;
      }
    }
  }

  // Merge edits that are separated only by blank lines (e.g. a section banner
  // followed by a doc comment) so the intervening blanks are removed too.
  const merged: Edit[] = [];
  for (const e of raw) {
    const prev = merged[merged.length - 1];
    if (prev) {
      let gap = prev.end;
      while (gap < e.start && isBlank(lines[gap])) gap++;
      if (gap === e.start) {
        prev.end = e.end;
        continue;
      }
    }
    merged.push({ ...e });
  }

  // Extend each edit over trailing blank lines so removal doesn't leave a
  // double-blank gap or a stray blank right after `{`.
  for (const e of merged) {
    let trail = e.end;
    while (trail < lines.length && isBlank(lines[trail])) trail++;
    if (trail > e.end) {
      const before = e.start === 0 ? "" : lines[e.start - 1];
      const blank_before = e.start === 0 || isBlank(before);
      const open_before = before.trimEnd().endsWith("{");
      e.end = blank_before || open_before ? trail : trail - 1;
    }
  }

  return merged;
}

function applyEdits(lines: string[], edits: Edit[]): string[] {
  if (edits.length === 0) return lines;
  const keep: string[] = [];
  let ei = 0;
  for (let i = 0; i < lines.length; i++) {
    if (ei < edits.length && i >= edits[ei].start && i < edits[ei].end) {
      if (i === edits[ei].end - 1) ei++;
      continue;
    }
    keep.push(lines[i]);
  }
  return keep;
}

/** Pure transform: returns the stripped source, or the input unchanged. */
export function stripLongComments(src: string, min = 4): string {
  const hadTrailingNL = src.endsWith("\n");
  const lines = src.split("\n");
  const edits = planEdits(lines, min);
  if (edits.length === 0) return src;
  const out = applyEdits(lines, edits);
  let text = out.join("\n");
  if (hadTrailingNL && !text.endsWith("\n")) text += "\n";
  return text;
}

// Trees whose .rs files are not processed:
//   - vendor/                            third-party code
//   - packages/                          externally-published crates (bun-native-plugin
//                                        renders `///` on docs.rs — user-facing API docs)
//   - scripts/verify-baseline-static/    CLAUDE.md cites line ranges into these sources;
//                                        the inline encoding-derivation comments are the
//                                        on-call triage doc
export const SKIP_PREFIXES = ["vendor/", "packages/", "scripts/verify-baseline-static/"];

export async function listTrackedRsFiles(cwd?: string): Promise<string[]> {
  const tracked = (await $`git ls-files '*.rs'`.cwd(cwd ?? process.cwd()).text()).split("\n").filter(Boolean);
  return tracked.filter(f => !SKIP_PREFIXES.some(p => f.startsWith(p)));
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry") || args.includes("-n");
  const minIdx = args.findIndex(a => a === "--min");
  const min = minIdx >= 0 ? Number(args[minIdx + 1]) : 4;
  if (!Number.isInteger(min) || min < 1) {
    console.error(`invalid --min value`);
    process.exit(1);
  }
  const minValueIdx = minIdx >= 0 ? minIdx + 1 : -1;
  const explicitFiles = args.filter((a, i) => !a.startsWith("-") && i !== minValueIdx);
  const files = explicitFiles.length > 0 ? explicitFiles : await listTrackedRsFiles();

  let changed = 0;
  let blocksRemoved = 0;
  let linesRemoved = 0;

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    const edits = planEdits(lines, min);
    if (edits.length === 0) continue;

    const removed = edits.reduce((n, e) => n + (e.end - e.start), 0);
    blocksRemoved += edits.length;
    linesRemoved += removed;
    changed++;

    if (dry) {
      for (const e of edits) {
        console.log(`${file}:${e.start + 1}-${e.end}: ${e.end - e.start} lines`);
      }
      continue;
    }

    // Reuse the edits already planned above instead of re-running the full
    // transform (planEdits + applyEdits) a second time inside stripLongComments.
    const out = applyEdits(lines, edits);
    let text = out.join("\n");
    if (src.endsWith("\n") && !text.endsWith("\n")) text += "\n";
    writeFileSync(file, text);
  }

  console.error(
    `strip-long-rs-comments: ${dry ? "would change" : "changed"} ${changed} file(s), ` +
      `removed ${blocksRemoved} block(s) / ${linesRemoved} line(s) ` +
      `(threshold >= ${min} lines; top-of-file, SAFETY, HOST_EXPORT kept)`,
  );
}

if (import.meta.main) await main();
