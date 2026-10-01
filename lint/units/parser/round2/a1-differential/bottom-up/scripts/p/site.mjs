// node site.mjs <sources.json> : base/head accept-reject for ts plain + whole tsc verdict; prints only R>A and A>R and A>A
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { whole } from "/tmp/a1bu/tsc.mjs";
const M = "/workspace/notes/lint/measure/parser";
const all = process.argv.includes("--all");
const file = process.argv[2];
const run = bin => execFileSync(`${M}/${bin}/bun`, ["/tmp/a1bu/p/ar.mjs", file], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean).map(l => JSON.parse(l));
const b = run("base"), h = run("head");
const NOISE = new Set([2304, 2307, 2503, 2564, 7006, 2693, 1225, 2842, 1108, 2378, 2314, 2315, 2318, 2322, 2339, 2345, 2355, 2391, 2552, 2583, 2584, 2695, 2711, 2749, 7005, 7008, 7010, 7019, 7031, 7034, 2300, 2451, 2365, 2367, 2882, 2635, 1340, 2411, 2792, 2354, 2532, 18048, 2741, 2551, 2694, 2708, 2709, 2713, 2724, 2339, 2663, 2304, 6133, 2454, 2448, 2449, 2450, 2683, 7041, 2531, 18047, 2722, 2349, 2554, 2555, 2556, 2351, 2348, 2872, 2873, 2869, 2871, 2845, 2774, 1361, 2693, 2362, 2363, 2356, 2357, 2358, 2359, 2360, 2361, 2365, 2367, 2363, 7053, 7015, 7017, 2538, 2537, 2536, 2344, 2559, 2560, 2739, 2740, 2769, 2488, 2461, 2548, 2549, 2495, 2802, 2569, 2322, 2394, 2393, 2389, 2384, 2383, 2385, 2386, 2717, 2687, 2300, 2403, 2740, 7022, 7023, 7024, 2502, 2506, 2456, 2589, 2590, 2321, 2312, 2310, 2313, 2314, 2707, 2558, 2706, 2744, 2743, 2515, 2511, 2512, 2513, 2514, 2516, 2510, 2415, 2416, 2417, 2420, 2422, 2423, 2425, 2426, 2430, 2540, 2542, 2704, 2790, 18046, 18004, 2539, 2588, 2630, 2631, 2632, 2629, 2779, 2780, 2777, 2778, 4104, 2352, 2353, 2741, 2464, 1345, 2774, 2801, 2367]);
const RES = new Set("break case catch class const continue debugger default delete do else enum export extends finally for function if in instanceof return super switch throw try var while with".split(" "));
for (let i = 0; i < b.length; i++) {
  const src = b[i].src;
  const bo = b[i].out[0], ho = h[i].out[0];
  const cls = `${bo[3]}>${ho[3]}`;
  if (!all && bo === ho) continue;
  const w = whole(src);
  const bad = w.parse.length ? "P:" + [...new Set(w.parse.map(d => d.code))].join(",") : (() => {
    const s = [...new Set(w.sem.filter(d => !NOISE.has(d.code) || ((d.code === 2304 || d.code === 2503) && (() => { const m = /'([^']+)'/.exec(typeof d.messageText === "string" ? d.messageText : d.messageText.messageText); return m && (m[1].startsWith("#") || RES.has(m[1])); })())).map(d => d.code))];
    return s.length ? "S:" + s.join(",") : "ok";
  })();
  console.log(`${cls}  tsc ${bad.padEnd(14)} ${JSON.stringify(src)}${bo === ho ? "" : `\n      base ${bo.slice(3, 90)}\n      head ${ho.slice(3, 90)}`}`);
}
