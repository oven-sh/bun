// Lists searched for an int32: lists of int32s, doubles, boxed values, holes, short and long, that change their kind between the searches; -0, NaN beside them; from a position.
function unique(l) { const out = []; for (const x of l) if (!out.includes(x)) out.push(x); return out; }
function where(l, x) { let n = 0; for (let i = 0; i < 40; i++) n = n * 3 + l.indexOf((x + i) | 0) | 0; return n; }
function from(l, p) { let n = 0; for (let i = 0; i < 12; i++) n += l.indexOf(i, p) + (l.includes(i, p) ? 100 : 0); return n; }
const l = [1, 2, 2, 3, 1, 4], kinds = [[], [1, 2, 3], [0.5, 1, 2], ["1", 1, {}, 3], [1, , 3], [-0, NaN, 0], Array.from({ length: 30 }, (_, i) => i * 2), Array.from({ length: 30 }, (_, i) => i / 2), [2147483647, -2147483648]];
for (let turn = 0; turn < 6; turn++) {
  console.log(unique(l).join(), unique([turn, 0.5, turn, -0, 0, 3]).join(), unique(["a", 1, "a", 1]).join());
  for (const k of kinds) console.log(where(k, 0), where(k, -3), where(k, 2147483640), from(k, 0), from(k, 2), from(k, -2));
  kinds[1].push(turn & 1 ? 0.5 : "t"); kinds[2].push(7); kinds[6][3] = turn / 2; l.push(turn);
}
