// A loop and a loop inside it push onto one list: the list is not as long as the outer counter says.
const show = l => "[" + l.map(x => (Object.is(x, -0) ? "-0" : typeof x === "object" ? "{" + x.v + "}" : String(x))).join() + "]";
function after(c) { const out = []; const l = [1, 2, 3]; for (let i = 0; i < 3; i++) { for (let q = 0; q < 2; q++) out.push(l[c]); out.push(l[c]); } return out; }
function before(c) { const out = []; const l = [1, 2, 3]; for (let i = 0; i < 3; i++) { out.push(l[c]); for (let q = 0; q < 2; q++) out.push(l[c] + 0.5); } return out; }
function both(l) { const out = []; for (let i = 0; i < l.length; i++) { out.push(l[i]); for (let q = 0; q < i; q++) out.push(l[q]); out.push(i); } return out; }
function under(c, l) { const out = []; for (let i = 0; i < 4; i++) { if (i & c) out.push(l[i]); out.push(l[i]); } return out; }
function indexed(l) { const out = []; for (let i = 0; i < 4; i++) { for (let q = 0; q < 2; q++) out[out.length] = l[q]; out[i] = l[i]; } return out; }
function popped(l) { const out = []; for (let i = 0; i < 4; i++) { out.push(l[i]); if (i & 1) out.pop(); } return out; }
function shortened(l) { const out = []; for (let i = 0; i < 4; i++) { out.push(l[i]); if (i === 2) out.length = 1; } return out; }
function two(l) { const a = [], b = []; for (let i = 0; i < 4; i++) { a.push(l[i]); for (let q = 0; q < 2; q++) { b.push(l[q]); if (q) a.push(-l[q]); } b.push(i); } return a.concat(b); }
function left(l) { const out = []; for (let i = 0; i < 4; i++) { for (let q = 0; q < 3; q++) { if (q === i) break; out.push(l[q]); } if (i === 1) continue; out.push(l[i]); } return out; }
function thrown(l) { const out = []; try { for (let i = 0; i < 4; i++) { for (let q = 0; q < i; q++) out.push(l[q]); out.push(l[i]); if (i === 2) throw out; } } catch (e) { return e; } return out; }
const lists = [() => [5, 3, 8, 1], () => [1.5, 0.5, 2.5, -0], () => ["a", "b", "c", "d"], () => [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }], () => [1, 2.5, 3, 4]];
for (let turn = 0; turn < 3; turn++) {
  for (const c of [0, 1, 2]) console.log(show(after(c)), show(before(c)));
  for (const list of lists) {
    console.log(show(both(list())), show(under(1, list())), show(under(2, list())), show(indexed(list())), show(popped(list())), show(shortened(list())));
    console.log(show(left(list())), show(thrown(list())), list()[0] === 5 || list()[0] === 1.5 ? show(two(list())) : "");
  }
}
