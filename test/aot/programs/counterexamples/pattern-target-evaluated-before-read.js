// In `({ x: target().f } = source)` the target is evaluated before x is read.
const s = { x: 1 }, o = { f: 0 };
({ x: (s.x = 2, o).f } = s);
console.log(o.f);
