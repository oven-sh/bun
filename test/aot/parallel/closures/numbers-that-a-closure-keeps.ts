function box(start: number) {
  let kept = start, later: number, big = 2 ** 53, tiny = -0, not = NaN;
  const set = (x: number) => { kept = x; };
  const fill = () => { later = kept / 3; };
  const read = () => [kept, later, big, Object.is(tiny, -0), Number.isNaN(not)];
  const grow = () => { big *= 4; tiny = tiny * 1; not = not + 1; };
  return { set, fill, read, grow };
}
const boxes = [box(1), box(1.5), box(-0), box(2 ** 31), box(Infinity)];
for (const b of boxes) console.log(JSON.stringify(b.read()));
for (const b of boxes) { b.fill(); b.grow(); b.set(0.1 + 0.2); }
for (const b of boxes) console.log(JSON.stringify(b.read()));
function dead() { const peek = () => early; try { peek(); } catch (e) { console.log((e as Error).name); } let early = 7.5; return peek; }
console.log(dead()());
const many: Array<() => number> = [];
for (let i = 0; i < 20000; i++) { let v = i * 0.5; many.push(() => (v += 0.25)); }
let all = 0; for (const f of many) all += f() + f();
console.log(all);
