// new SourceMap(json) parse throughput.
//
//   bun bench/snippets/source-map-parse.mjs [path/to/bundle.js.map]
//   node bench/snippets/source-map-parse.mjs [path/to/bundle.js.map]
//
// With no argument, generates a 10 MB bundler-shaped mappings string
// (2M four-field segments) so the bench is self-contained.

import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { bench, run } from "../runner.mjs";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(v) {
  let q = v < 0 ? (-v << 1) | 1 : v << 1;
  let out = "";
  do {
    let d = q & 31;
    q >>>= 5;
    if (q) d |= 32;
    out += BASE64[d];
  } while (q);
  return out;
}

function bundlerShaped(segments) {
  // All 4-field, all 1-char VLQs: the shape `bun build --sourcemap`
  // produces (and 76.6% of segments in a measured 68 MB production map).
  const segs = [];
  for (let i = 0; i < segments; i++) {
    segs.push(vlq(1 + (i % 14)) + vlq(0) + vlq(i % 3) + vlq((i % 5) + 1));
  }
  return segs.join(",");
}

let payload;
let label;
const arg = process.argv[2];
if (arg && !arg.startsWith("-")) {
  payload = JSON.parse(readFileSync(arg, "utf8"));
  const mb = (payload.mappings.length / 1024 / 1024).toFixed(1);
  label = `new SourceMap(${mb} MB)`;
} else {
  const segments = 2_000_000;
  const mappings = bundlerShaped(segments);
  const mb = (mappings.length / 1024 / 1024).toFixed(1);
  payload = { version: 3, sources: ["bundle.js"], names: [], mappings };
  label = `new SourceMap(${mb} MB)`;
}

// Warm the dispatch cache once so the first timed iteration isn't cold.
new SourceMap(payload);

bench(label, () => new SourceMap(payload));

await run();
