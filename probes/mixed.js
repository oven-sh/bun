// A failing toMatchObject whose pattern has one matcher and N plain records: the mismatch is at the first key.
const { expect } = require("bun:test");
function timeOnce(fn) { const t0 = performance.now(); let threw = null; try { fn(); } catch (e) { threw = e; } return { ms: performance.now() - t0, threw }; }
function bench(label, fn, reps = 9) {
  timeOnce(fn); timeOnce(fn);
  const runs = []; let last;
  for (let i = 0; i < reps; i++) { last = timeOnce(fn); runs.push(last.ms); }
  runs.sort((a, b) => a - b);
  const msg = last.threw ? Bun.stripANSI(String(last.threw.message)) : "";
  const counts = (msg.match(/^[-+] (Expected|Received) +[-+] \d+$/gm) ?? []).join(" ");
  console.log(label.padEnd(70), runs[(reps - 1) >> 1].toFixed(3).padStart(10), "ms  min", runs[0].toFixed(3).padStart(9), " ", counts);
}
const rec = i => ({ id: i, name: "user" + i, tags: ["a", "b", "c"], owner: { id: i % 7, name: "o" + (i % 7), address: { city: "x", zip: "12345" } }, active: true, score: i * 1.5 });
for (const n of [10, 100, 1000, 20000]) {
  const recv = { status: 500, when: 1, items: Array.from({ length: n }, (_, i) => rec(i)) };
  const pattern = { status: 200, when: expect.any(Number), items: Array.from({ length: n }, (_, i) => rec(i)) };
  bench(`FAIL first key; one matcher and ${n} plain records after it`, () => expect(recv).toMatchObject(pattern));
}
