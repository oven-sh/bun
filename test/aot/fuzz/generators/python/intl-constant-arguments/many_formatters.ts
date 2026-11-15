// @ts-nocheck
// Formatters made from constants by the hundred thousand, some of which need ICU later, with collections in between: no crash, no growth without bound, the same answers.
const boxes = []; const hide = x => { boxes.push(x); return boxes.pop(); };
const twin = new Intl.DateTimeFormat(hide("en-US"), hide({ dateStyle: "short", timeStyle: "medium", timeZone: "America/New_York" })), number = new Intl.NumberFormat(hide("de"), hide({ minimumFractionDigits: 2 }));
let mismatches = 0; const survivors = [];
const start = process.memoryUsage().rss;
for (let i = 0; i < 400000; i++) {
  const t = i * 4.1e6 * 1000 % 4e12, f = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "medium", timeZone: "America/New_York" }), n = new Intl.NumberFormat("de", { minimumFractionDigits: 2 });
  if (f.format(t) !== twin.format(t) || n.format(t / 7) !== number.format(t / 7)) mismatches++;
  if (i % 1000 === 0) { if (f.formatToParts(t).map(p => p.value).join("") !== twin.format(t)) mismatches++; if (f.resolvedOptions().timeZone !== "America/New_York") mismatches++; }
  if (i % 5000 === 0) survivors.push(f, n);
  if (i % 50000 === 0) Bun.gc(true);
}
Bun.gc(true);
for (const f of survivors) if (f instanceof Intl.DateTimeFormat ? f.format(1e12) !== twin.format(1e12) : f.format(1234.5) !== number.format(1234.5)) mismatches++;
const grown = Math.round((process.memoryUsage().rss - start) / 1048576);
console.log("formatters 800000 | mismatches " + mismatches + " | resident memory grew by " + (grown < 300 ? "less than 300 MB" : grown + " MB"));
