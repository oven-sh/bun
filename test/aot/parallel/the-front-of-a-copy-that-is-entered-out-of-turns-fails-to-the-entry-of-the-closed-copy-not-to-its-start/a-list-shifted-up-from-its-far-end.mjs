// Under: --aot-testing=FailGuesses:7:61: a guess in the front of the copy that the typed copy leaves for fails in the middle of the loop
// Under: --aot-testing=FailGuesses: every guess fails
let m = 5;
function show(...all) { return all.map(one => (typeof one)[0] + (Object.is(one, -0) ? "-0" : String(one))).join(" "); }
class Kept { l = []; }
const kept = new Kept();
for (let i = 0; i < 12; i++) kept.l.push(i * 3 + 0.5);
const widths = new Uint16Array([0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3]);
function run(a, b, o, n, stop, mark) {
  let s = 0, t = 0.5, x = 0, h = 0;
  for (let c = a.length - 1; c >= 0; c--) { if (a[c] === mark) h++; x = a[c - 1]; if (c + 1 < a.length) a[c + 1] = x; }
  return show(s, t, x, h, a[0], a.length, b[0], o.n);
}
for (const [n, stop, mark] of JSON.parse("[[8, 0, 9], [5, 3, 1], [11, 99, 7], [0, 0, 3]]")) {
  const a = JSON.parse("[3, 1, 4, 1, 5, 9, 2, 6]"), b = [0, 0, 0, 0, 0, 0, 0, 0], o = { n: 3, l: [2, 7, 1, 8, 2, 8, 1, 8] };
  let said; try { said = run(a, b, o, n, stop, mark); } catch { said = "threw"; }
  console.log(said + " | " + show(m, o.n, a.length) + " | " + show(...a) + " | " + show(...b));
}
export {};
