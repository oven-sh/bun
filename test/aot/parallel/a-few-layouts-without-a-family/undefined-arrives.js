function weigh(e) { if (e.kind === "leaf") return e.value; return weigh(e.left) + weigh(e.right); }
const good = { kind: "pair", left: { kind: "leaf", value: 1 }, right: { kind: "leaf", value: 2 } }, bad = { kind: "pair", left: { kind: "leaf", value: 1 }, right: undefined };
let t = 0; for (let i = 0; i < 500; i++) t += weigh(good);
try { weigh(bad); } catch (error) { console.log(error instanceof TypeError, error.message); }
console.log(t);
