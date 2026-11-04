// minus zero through a set and the keys of a map: they keep +0, which is an integer where -0 is none
function show(...all) { console.log(all.join(" ")); }
function main() {
  const x = [...new Set([-0])][0];
  show("spread", Object.is(x, 0), Object.is(x, -0), 1 / x, x | 0, x + 1, ["a", "b"][x], String(x), x === 0);
  const k = [...new Map([[-0, "v"]]).keys()][0];
  show("key", Object.is(k, 0), 1 / k, k + 1, k === 0);
  const s = new Set(); s.add(-0); const y = [...s][0];
  show("added", Object.is(y, 0), 1 / y, y + 1, y === 0);
  const l = Array.from(new Set([-0]));
  show("from", Object.is(l[0], 0), 1 / l[0], l[0] + 1, l[0] === 0);
  const m = new Map(); m.set(-0, 1); const e = [...m.entries()][0];
  show("entry", Object.is(e[0], 0), 1 / e[0], e[0] + 1);
  const kept = [-0]; show("a list keeps it", Object.is(kept[0], -0), 1 / kept[0], kept[0] + 1);
  const v = [...new Map([[1, -0]]).values()][0]; show("a value is kept", Object.is(v, -0), 1 / v, v + 1);
}
main();
