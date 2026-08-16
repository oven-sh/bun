// Cost of async content-handler suspension in HTMLRewriter.
//
// Three handler shapes over the same input:
//   sync:       element(el) { el.setAttribute(...) }                     — no suspension
//   microtask:  async element(el) { await 0; el.setAttribute(...) }      — settles in the
//               microtask checkpoint, so lol-html is NOT suspended
//   suspend:    async element(el) { await immediate; el.setAttribute() } — forces lol-html to
//               deep-copy the token, return Suspended, and resume() from a promise reaction
//
// Reports per-rewrite time (mitata) and steady-state RSS.
//
//   bun bd bench/snippets/html-rewriter-suspend.mjs
//   ELEMENTS=2000 bun bd bench/snippets/html-rewriter-suspend.mjs

import { bench, group, run } from "../runner.mjs";

const ELEMENTS = Number(process.env.ELEMENTS ?? 500);
const ATTR_COUNT = 4;

// Build one realistic-ish element and repeat it N times so the token lol-html
// parks on suspend is not degenerate (has attributes to copy).
let element = "<p";
for (let i = 0; i < ATTR_COUNT; i++) element += ` data-k${i}="vvvvvvvvvvvvvvvv"`;
element += ">hello</p>";
const htmlInput =
  "<!doctype html><body>" +
  Array.from({ length: ELEMENTS }, () => element).join("") +
  "</body>";
const inputBytes = Buffer.byteLength(htmlInput);

const rw = () => new HTMLRewriter();
const immediate = () => new Promise(r => setImmediate(r));

const handlers = {
  sync: {
    element(el) {
      el.setAttribute("x", "1");
    },
  },
  microtask: {
    async element(el) {
      await 0;
      el.setAttribute("x", "1");
    },
  },
  suspend: {
    async element(el) {
      await immediate();
      el.setAttribute("x", "1");
    },
  },
};

async function once(kind) {
  await rw().on("p", handlers[kind]).transform(new Response(htmlInput)).text();
}

// ── throughput ───────────────────────────────────────────────────────────
group(`transform ${ELEMENTS} <p> elements (${(inputBytes / 1024).toFixed(1)} KB)`, () => {
  for (const kind of Object.keys(handlers)) {
    bench(kind, async () => {
      await once(kind);
    });
  }
});

await run();

// ── RSS at steady state ──────────────────────────────────────────────────
// mitata doesn't track RSS; measure it separately after a warmup so allocator
// footprint is established. Reported as peak-after-pass minus baseline.
const rss = process.memoryUsage.rss;
async function rssPass(kind, n) {
  for (let i = 0; i < n; i++) await once(kind);
  Bun.gc(true);
  return rss();
}

console.log("\nsteady-state RSS (after 200-iteration warmup, 200-iteration pass):");
for (const kind of Object.keys(handlers)) {
  await rssPass(kind, 200);
  const before = await rssPass(kind, 0);
  const after = await rssPass(kind, 200);
  console.log(
    `  ${kind.padEnd(10)} baseline ${(before / 1024 / 1024).toFixed(1)} MB, ` +
      `after ${(after / 1024 / 1024).toFixed(1)} MB, ` +
      `delta ${((after - before) / 1024 / 1024).toFixed(2)} MB`,
  );
}

// ── per-suspension cost ──────────────────────────────────────────────────
// Derived from the mitata run above (suspend - sync) / ELEMENTS, printed for
// convenience; the mitata table is the authoritative measurement.
console.log(
  `\nper-element suspension overhead is (suspend_time - sync_time) / ${ELEMENTS}; ` +
    `read it from the mitata table above.`,
);
