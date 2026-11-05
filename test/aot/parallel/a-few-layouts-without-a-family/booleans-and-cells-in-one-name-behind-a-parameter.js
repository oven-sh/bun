function flag(o, d) { return d ? flag(o, d - 1) : o.on; }
const a = { on: true, p: "x", q: "y" }, b = { on: "yes", s: 1 }, c = { on: { deep: 1 }, t: 2, u: 3 };
let out = []; for (let i = 0; i < 100; i++) { out.push(flag(a, 1)); out.push(flag(b, 1)); out.push(flag(c, 1)); } console.log(out[0], out[1], JSON.stringify(out[2]), out[297], out[298]);
