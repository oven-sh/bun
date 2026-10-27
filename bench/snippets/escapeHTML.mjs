// Benchmark for `Bun.escapeHTML` across a matrix of input shapes.
//
// Run the same file with each binary to compare:
//   bun-1.3.14  (Zig)   vs
//   main        (Rust)  vs
//   this branch (C++ + Highway SIMD)
//
//   path/to/bun run bench/snippets/escapeHTML.mjs
//
// Covers: short vs long, latin1 vs utf16 backing, and escape-heavy vs
// passthrough (nothing to escape — the common case / zero-copy fast path).
import { bench, group, run } from "../runner.mjs";

const escapeHTML = globalThis.escapeHTML || Bun.escapeHTML;

// A chunk with a handful of metacharacters (~6% of bytes escape).
const HTML_CHUNK = `<a href="/p?x=1&y=2" title='hi'>link</a> plain text here. `;
// A chunk with no metacharacters at all (exercises the passthrough fast path).
const PLAIN_CHUNK = "the quick brown fox jumps over the lazy dog 1234567890. ";

const inputs = [
  { name: "latin1 short, escapes", input: "<script>alert('xss')</script>" },
  { name: "latin1 short, passthrough", input: "the quick brown fox jumped" },
  { name: "latin1 long, escapes (~57KB)", input: HTML_CHUNK.repeat(1000) },
  { name: "latin1 long, passthrough (~56KB)", input: PLAIN_CHUNK.repeat(1000) },
  { name: "utf16 short, escapes", input: "<b>café</b> ☕ <i>déjà</i>" },
  { name: "utf16 short, passthrough", input: "café déjà vu — ☕ premium" },
  { name: "utf16 long, escapes (~60KB)", input: (HTML_CHUNK + "café ☕ ").repeat(900) },
  { name: "utf16 long, passthrough (~58KB)", input: (PLAIN_CHUNK + "café ☕ ").repeat(900) },
];

for (const { name, input } of inputs) {
  // is8Bit / is16Bit is an internal detail; note the encoding in the label.
  const chars = new Intl.NumberFormat().format(input.length);
  group({ summary: true, name: `${name} (${chars} chars)` }, () => {
    bench("Bun.escapeHTML", () => escapeHTML(input));
  });
}

await run();
