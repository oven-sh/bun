// Under: --aot-check=Validate: one address was read under the heap of boxed elements and written as a raw double in one layout of a turn: the builder stopped a right program
function show(...all) { return all.map(one => (typeof one)[0] + (Object.is(one, -0) ? "-0" : String(one))).join(" "); }
function pushed(count) { const made = []; for (let i = 0; i < count; i++) made.push((i * 5 + 3) & 7); return made; }
let held = [];
function run(n, stop, mark) { let s = 0, t = 0.5, x = 0, h = 0; for (let c = 0; c < held.length; c++) { s = (s + held[c]) | 0; held[c] = t; s += held[(c + 3) & 7]; } return show(s, t, x, h, held[0], held.length); }
for (const [n, stop, mark] of JSON.parse("[[8, 0, 9], [5, 3, 1], [11, 99, 7], [0, 0, 3]]")) {
  const list = [3.5, 1.5, 4.5, 1.5, 5.5, 9, 2.5, 6.5];
  let said; try { said = ((held = list), run(n, stop, mark)); } catch { said = "threw"; }
  console.log(said + " | " + show(list.length) + " | " + show(...list));
}
export {};
