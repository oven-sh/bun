#!/usr/bin/env bun
// Cross-check hand-declared Rust externs against the C++ callee summaries.
//
//   bun scripts/jsc-exception-lint/rust-externs.ts [--summaries <tsv>]
//
// The Rust side calls C++ through `unsafe extern "C"` blocks. A C++ function
// that takes a JSGlobalObject* and can throw must be called through one of the
// scope helpers (call_zero_is_throw, call_check_slow, from_js_host_call, ...)
// or inside a top_scope!/validation_scope! so that the Rust side observes the
// exception. This script lists extern declarations whose C++ definition the
// summary pass classified as able to throw, and the call sites that are not
// wrapped. It is a heuristic: it looks at the text around each call.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const sIdx = args.indexOf("--summaries");
const summaryFile = sIdx !== -1 ? args[sIdx + 1] : join(repo, "build/debug/jsc-exception-lint/bun-summaries.tsv");
if (!existsSync(summaryFile)) {
  console.error(`missing ${summaryFile}; run scripts/jsc-exception-lint/run.ts first`);
  process.exit(1);
}

type Summary = { kind: string; exit: number; why: string };
const summaries = new Map<string, Summary>();
for (const line of readFileSync(summaryFile, "utf8").split("\n")) {
  const [, key, kind, exit, , why] = line.split("\t");
  if (!key) continue;
  // Key is `qualified::name/arity`. extern "C" symbols are unqualified, but
  // may be declared inside a namespace block; index by the last component.
  const name = key.slice(0, key.lastIndexOf("/"));
  const short = name.includes("::") ? name.slice(name.lastIndexOf("::") + 2) : name;
  const prev = summaries.get(short);
  const s = { kind, exit: Number(exit), why };
  // Keep the more pessimistic one.
  if (!prev || rank(s) > rank(prev)) summaries.set(short, s);
}
function rank(s: Summary): number {
  if (s.kind === "maythrow") return 3;
  if (s.kind === "thrower") return 2;
  if (s.kind === "transparent" && s.exit & ~1) return 2;
  return 0;
}
function mayThrow(s: Summary): boolean {
  return rank(s) > 0;
}

const rsFiles: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (e.name === "target" || e.name === "node_modules") continue;
      walk(p);
    } else if (e.name.endsWith(".rs")) rsFiles.push(p);
  }
})(join(repo, "src"));

type Decl = { name: string; file: string; line: number; arity: number; hasGlobal: boolean; ret: string };
const decls = new Map<string, Decl>();
const declRe =
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+|safe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{]*?)\)\s*(?:->\s*([^;{]+?))?\s*;/gm;
const sources = new Map<string, string>();
for (const f of rsFiles) {
  const text = readFileSync(f, "utf8");
  sources.set(f, text);
  // Only declarations inside extern blocks.
  const externRe = /extern\s+"(?:C|sysv64|system)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = externRe.exec(text))) {
    // Find the matching close brace.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = text.slice(m.index, i);
    let d: RegExpExecArray | null;
    declRe.lastIndex = 0;
    while ((d = declRe.exec(block))) {
      const [, name, params, ret] = d;
      const arity = params.trim() ? params.split(",").filter(p => p.trim()).length : 0;
      const line = text.slice(0, m.index + d.index).split("\n").length;
      decls.set(name, {
        name,
        file: f,
        line,
        arity,
        hasGlobal: /JSGlobalObject/.test(params),
        ret: (ret ?? "()").trim(),
      });
    }
  }
}

const wrappers =
  /call_zero_is_throw|call_check_slow|from_js_host_call|call_false_is_throw|call_null_is_throw|top_scope!|validation_scope!|host_fn_result|return_if_exception|assert_exception_presence_matches/;

let reported = 0;
for (const d of [...decls.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  if (!d.hasGlobal) continue;
  const s = summaries.get(d.name);
  if (!s) continue; // not a C++ function the summary pass saw (Rust-exported, or unused)
  if (!mayThrow(s)) continue;
  const callRe = new RegExp(`\\b${d.name}\\s*\\(`, "g");
  const unwrapped: string[] = [];
  for (const [f, text] of sources) {
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 600), m.index);
      // Skip the declaration itself and re-exports.
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      const lineText = text.slice(lineStart, text.indexOf("\n", m.index));
      if (
        /\bfn\s+\w+\s*\($/.test(text.slice(lineStart, m.index + m[0].length)) ||
        /^\s*(pub\s+)?(unsafe\s+|safe\s+)?fn\b/.test(lineText)
      )
        continue;
      if (/^\s*\/\//.test(lineText)) continue;
      const after = text.slice(m.index, m.index + 400);
      if (
        wrappers.test(before.slice(-400)) ||
        /return_if_exception|assert_exception_presence_matches|\.exception\(\)/.test(after)
      )
        continue;
      const line = text.slice(0, m.index).split("\n").length;
      unwrapped.push(`${relative(repo, f)}:${line}: ${lineText.trim().slice(0, 140)}`);
    }
  }
  if (!unwrapped.length) continue;
  reported++;
  console.log(`\n${d.name} (${relative(repo, d.file)}:${d.line}) -> ${d.ret}`);
  console.log(`  C++: ${s.kind}${s.kind === "transparent" ? ` exit=${s.exit}` : ""} (${s.why})`);
  for (const u of unwrapped) console.log(`  unwrapped: ${u}`);
}
console.error(`\n${reported} externs with unwrapped call sites`);
