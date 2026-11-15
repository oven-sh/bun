// @ts-nocheck
// Eight workers and the main thread format at the same time with the same constant call sites (named time zones: the fast path caches an offset range), hopping across offset changes. Each compares with a twin made from opaque arguments.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
const boxes = []; const hide = x => { boxes.push(x); return boxes.pop(); };
const york = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "medium", timeZone: "America/New_York" }), yorkTwin = new Intl.DateTimeFormat(hide("en-US"), hide({ dateStyle: "short", timeStyle: "medium", timeZone: "America/New_York" }));
function hammer(seed) {
  let mismatches = 0, comparisons = 0, state = seed;
  const twinOptions = hide({ dateStyle: "short", timeStyle: "medium", timeZone: "Europe/London" }), apia = hide({ timeStyle: "medium", dateStyle: "medium", timeZone: "Pacific/Apia" });
  const london = new Intl.DateTimeFormat(hide("en-GB"), twinOptions), samoa = new Intl.DateTimeFormat(hide("en-US"), apia), german = new Intl.NumberFormat(hide("de"), hide({ minimumFractionDigits: 2 }));
  for (let i = 0; i < 60000; i++) {
    state = (state * 48271) % 2147483647; const t = Date.UTC(1950, 0, 1) + (state / 2147483647) * 4.7e12, d = new Date(t);
    comparisons += 4;
    if (york.format(d) !== yorkTwin.format(d)) mismatches++;
    if (d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/London" }) !== london.format(d)) mismatches++;
    if (d.toLocaleString("en-US", { timeStyle: "medium", dateStyle: "medium", timeZone: "Pacific/Apia" }) !== samoa.format(d)) mismatches++;
    if ((t / 1e5).toLocaleString("de", { minimumFractionDigits: 2 }) !== german.format(t / 1e5)) mismatches++;
  }
  return [comparisons, mismatches];
}
if (isMainThread) {
  const workers = Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => { const w = new Worker(import.meta.path ?? __filename, { workerData: i + 2 }); w.on("message", resolve); w.on("error", reject); }));
  const own = hammer(1); const all = await Promise.all(workers); all.push(own);
  console.log("threads " + all.length + " | comparisons " + all.reduce((s, r) => s + r[0], 0) + " | mismatches " + all.reduce((s, r) => s + r[1], 0));
  process.exit(0);
} else parentPort.postMessage(hammer(workerData));
