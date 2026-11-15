let turns = 0, last = -1, sum = 0, label = "none";
const parsed = text => JSON.parse(text);
function running(a, b) { for (let i = 1; i < a.length; i++) { turns += 1; if (a[i] > 2) last = i; b[i] = b[i - 1] + a[i]; } return b.length; }
function picked(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] > 1.5) { sum += a[i]; label = "at " + i; } b[i] = a[i] * 2; } return b.length; }
function reads(a, b) { for (let i = 1; i < a.length; i++) { turns += 2; b[i] = turns + a[i]; last = turns; } return b.length; }
function throws(a, b) { for (let i = 0; i < a.length; i++) { turns += 1; if (a[i] === undefined) throw new RangeError("hole at " + i); b[i] = a[i] + 0.5; } return b.length; }
const table = [running, picked, reads, throws];
const fractions = n => parsed("[" + Array.from({ length: n }, (_, i) => (i % 5) + 0.25).join() + "]");
const wholes = n => parsed("[" + Array.from({ length: n }, (_, i) => i % 5).join() + "]");
const said = [];
function once(which, a, b) {
  turns = 0; last = -1; sum = 0; label = "none";
  let end;
  try { end = table[parsed(String(which))](a, b); } catch (error) { end = error.message; }
  said.push([which, end, turns, last, sum, label, b.length, String(b[b.length - 1])].join("|"));
}
for (let round = 0; round < 60; round++) {
  for (let which = 0; which < 4; which++) {
    once(which, fractions(16), fractions(16));
    once(which, fractions(16), fractions(9));
    once(which, fractions(16), wholes(16));
    once(which, wholes(16), wholes(16));
    const holed = fractions(16); delete holed[11];
    once(which, fractions(16), holed);
    once(which, holed, fractions(16));
    const mixed = fractions(16); mixed[7] = "seven";
    once(which, mixed, fractions(16));
    once(which, fractions(16), Object.freeze(fractions(16)));
    once(which, fractions(16), []);
    const watched = fractions(16);
    Object.defineProperty(watched, 5, { get() { return turns * 100 + last; }, set(value) { label = "set " + value + " in turn " + turns; }, configurable: true });
    once(which, fractions(16), watched);
    once(which, watched, fractions(16));
    once(which, fractions(16), new Float64Array(12));
  }
}
console.log(said.slice(-48).join("\n"));
