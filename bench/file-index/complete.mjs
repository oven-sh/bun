// Per-keystroke fuzzy autocomplete latency: Bun.FileIndex.complete() vs two
// pure-JS baselines over the same path list (a naive substring filter, and a
// subsequence scorer + top-K). The index is built once per size; only the
// query is timed. mitata's min / p50 / max columns are the best / median /
// worst per-keystroke latency.
//
// complete() keeps a per-index survivor cache that is reused whenever a query
// equals or extends the previous one, so the same call is two very different
// operations depending on what ran before it. Each needle is therefore
// reported twice:
//   - "cold":         the cache is busted before every timed call by first
//                     issuing a decoy query that the needle does not extend.
//   - "warm (cache)": the identical query repeated back to back (a cache hit).
// The decoy is part of the cold bench's timed body, but it matches nothing
// (no synthetic path contains "@" or "~") so it returns in ~1 µs — under
// 0.2% of the cheapest cold query — and does not move the cold numbers. Its
// measured cost is printed per size so that claim is checked on every run.
//
//   FILE_INDEX_BENCH_SIZES=10000,100000,250000   path counts (comma separated)
import { bench, group, run } from "../runner.mjs";
import { assertEqual, hasFileIndex, syntheticPaths, tempRoot, writeTree } from "./lib.mjs";

if (!hasFileIndex) {
  console.log("Bun.FileIndex is not available in this runtime; only the JS baselines run.");
}

const sizes = (process.env.FILE_INDEX_BENCH_SIZES || "10000,100000,250000")
  .split(",")
  .map(s => parseInt(s, 10))
  .filter(n => n > 0);

const LIMIT = 32;
// "short" is a worst case (almost every path survives the subsequence
// prefilter); "long" exercises the scorer on few survivors; "path-like"
// is what an editor sends after a few keystrokes.
const NEEDLES = [
  ["short", "in"],
  ["medium", "srvidx"],
  ["long", "componentsindexts"],
  ["path-like", "src/index"],
];
// Cache-busting decoys for the "cold" benches: none of the needles above
// extends either, and neither character appears in any synthetic path, so the
// index rejects them almost for free. Two are alternated so consecutive decoy
// calls never equal each other either.
const DECOYS = ["@", "~"];

// --- pure-JS baselines ------------------------------------------------------

function naiveFilter(paths, needle, limit) {
  const out = [];
  for (let i = 0; i < paths.length && out.length < limit; i++) {
    if (paths[i].includes(needle)) out.push(paths[i]);
  }
  return out;
}

// A representative userland implementation: ASCII-case-insensitive subsequence
// match with consecutive-run and word-boundary bonuses, keeping the top K.
// (Deliberately simple — this is the "what you'd write in JS" baseline.)
function subsequenceScore(haystack, needleLower) {
  let hi = 0;
  let prev = -2;
  let score = 0;
  for (let ni = 0; ni < needleLower.length; ni++) {
    const want = needleLower.charCodeAt(ni);
    let found = -1;
    while (hi < haystack.length) {
      let h = haystack.charCodeAt(hi);
      if (h >= 65 && h <= 90) h += 32;
      if (h === want) {
        found = hi++;
        break;
      }
      hi++;
    }
    if (found === -1) return -Infinity;
    score += 16;
    if (found === prev + 1) score += 8;
    const before = found === 0 ? 47 : haystack.charCodeAt(found - 1);
    if (before === 47 || before === 46 || before === 95 || before === 45) score += 12;
    prev = found;
  }
  return score - haystack.length;
}

function jsFuzzyTopK(paths, needle, limit) {
  const needleLower = needle.toLowerCase();
  // Top-K by insertion into a small sorted array (K = 32 keeps this honest).
  const top = [];
  let worst = -Infinity;
  for (let i = 0; i < paths.length; i++) {
    const s = subsequenceScore(paths[i], needleLower);
    if (s === -Infinity || (top.length === limit && s <= worst)) continue;
    let lo = 0;
    while (lo < top.length && top[lo].score >= s) lo++;
    top.splice(lo, 0, { path: paths[i], score: s });
    if (top.length > limit) top.pop();
    worst = top[top.length - 1].score;
  }
  return top;
}

// --- per-size setup (not timed) ---------------------------------------------

const cleanups = [];
for (const size of sizes) {
  const paths = syntheticPaths(size, 7);
  let index;
  if (hasFileIndex) {
    const { root, cleanup } = tempRoot(`file-index-complete-${size}`);
    cleanups.push(cleanup);
    writeTree(root, paths);
    index = new Bun.FileIndex(root);
    await index.ready;
    cleanups.push(() => index.close());

    // The decoys must match nothing (otherwise they would not be cheap) and
    // their cost must be noise next to the cold queries they precede. Print
    // it so the "negligible" claim above is re-checked on every run/machine.
    const decoyNs = [];
    for (let i = 0; i < 64; i++) {
      const decoy = DECOYS[i % DECOYS.length];
      const t0 = Bun.nanoseconds();
      const hits = index.complete(decoy, { limit: LIMIT });
      decoyNs.push(Bun.nanoseconds() - t0);
      assertEqual(hits.length, 0, `decoy ${JSON.stringify(decoy)} matches nothing at size ${size}`);
    }
    decoyNs.sort((a, b) => a - b);
    console.log(
      `cache-bust decoy over ${size} paths: ${(decoyNs[decoyNs.length >> 1] / 1e3).toFixed(2)} µs median ` +
        `(included in the timed body of the "cold" benches below)`,
    );
  }

  for (const [kind, needle] of NEEDLES) {
    if (index) {
      // Correctness before timing: every result is a real subsequence match.
      const results = index.complete(needle, { limit: LIMIT });
      if (results.length === 0) throw new Error(`complete(${JSON.stringify(needle)}) found nothing at size ${size}`);
      for (const r of results) {
        assertEqual(
          r.positions.map(p => r.path[p].toLowerCase()).join(""),
          needle.toLowerCase(),
          `positions of ${r.path}`,
        );
      }
      assertEqual(jsFuzzyTopK(paths, needle, LIMIT).length > 0, true, "JS baseline finds matches");
    }

    group(`complete "${needle}" (${kind}) over ${size} paths, limit ${LIMIT}`, () => {
      if (index) {
        // The decoy neither equals nor is extended by `needle`, so every
        // timed call below pays the full uncached scan + score + rank.
        let calls = 0;
        bench(`Bun.FileIndex.complete cold (${size})`, () => {
          index.complete(DECOYS[calls++ % DECOYS.length], { limit: LIMIT });
          index.complete(needle, { limit: LIMIT });
        });
        // Identical query repeated back to back: the survivor-cache hit path.
        bench(`Bun.FileIndex.complete warm (cache) (${size})`, () => {
          index.complete(needle, { limit: LIMIT });
        });
      }
      bench(`JS subsequence scorer + topK (${size})`, () => {
        jsFuzzyTopK(paths, needle, LIMIT);
      });
      bench(`JS naive .includes filter (${size})`, () => {
        naiveFilter(paths, needle, LIMIT);
      });
    });
  }
}

await run({ avg: true, min_max: true, percentiles: true });
for (const cleanup of cleanups) cleanup();
