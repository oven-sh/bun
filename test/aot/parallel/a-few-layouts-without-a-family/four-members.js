function cost(o) { switch (o.kind) { case "a": return o.x; case "b": return o.x + o.y; case "c": return o.z * 2; default: return o.w.length; } }
const all = [{ kind: "a", x: 1 }, { kind: "b", x: 2, y: 3 }, { kind: "c", z: 4 }, { kind: "d", w: "five" }];
let t = 0; for (let i = 0; i < 4000; i++) t += cost(all[i & 3]); console.log(t);
