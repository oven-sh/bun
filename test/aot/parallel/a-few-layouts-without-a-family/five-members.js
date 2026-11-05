function cost(o) { switch (o.kind) { case "a": return o.x; case "b": return o.x + o.y; case "c": return o.z * 2; case "d": return o.w.length; default: return o.v ? 1 : 0; } }
const all = [{ kind: "a", x: 1 }, { kind: "b", x: 2, y: 3 }, { kind: "c", z: 4 }, { kind: "d", w: "five" }, { kind: "e", v: true }];
let t = 0; for (let i = 0; i < 5000; i++) t += cost(all[i % 5]); console.log(t);
