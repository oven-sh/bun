// An operator of a stretch that is walked typed has ways of its own: what one of them has shown of an operand holds on that way alone.
class V { constructor(x, y) { this.x = x; this.y = y; } }
const L = [0, 1, 2, 3], M = [1, "a", 2.5, null, undefined, 4];
async function inAsync() { let p = { x: 1, y: 1, z: 9 }; const g = () => p; for (const i of L) { p = { x: p.x + i, y: p.y, z: i }; p.x += 1; } p.x = "chg"; return [p, g]; }
async function ofText(l) { let p = { x: "t", y: 1, z: 9 }; const g = () => p; for (const i of l) { p = { x: p.x + i, y: p.y, z: i }; p.x += 1; } p.x = p.x + "chg"; return [p, g]; }
async function mixed(l, o) { let p = o; const g = () => p; for (const i of l) { p = { x: p.x + i, y: p.y - 1, z: i }; if (i === 2.5) p.x = "chg"; p.x += p.y; } return [p, g]; }
function plain(l, o) { let p = o; const g = () => p; for (const i of l) { p = { x: p.x + i, y: p.y, z: i }; p.x += 1; } p.x = "chg"; return [p, g]; }
function other(a) { return { x: 0.5, y: a }; }
const out = [];
const show = ([p, g]) => out.push(JSON.stringify(p), g() === p, String(g().x));
for (let round = 0; round < 3; round++) {
  show(await inAsync()); show(await ofText(L)); show(await ofText(M)); show(await mixed(L, { x: 1, y: 2, z: 0 })); show(await mixed(M, { x: 1, y: 2, z: 0 })); show(await mixed(M, new V("v", 3))); show(await mixed(L, other(7)));
  show(plain(L, { x: 1, y: 1, z: 9 })); show(plain(M, { x: 1, y: 1, z: 9 })); show(plain(M, new V(0.5, 1))); show(plain(L, other("w")));
  console.log(out.splice(0).join(" "));
}
