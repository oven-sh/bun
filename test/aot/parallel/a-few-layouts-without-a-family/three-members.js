function weigh(e) { if (e.kind === "leaf") return e.value; if (e.kind === "pair") return weigh(e.left) + weigh(e.right); return -weigh(e.inner); }
const tree = { kind: "pair", left: { kind: "flip", inner: { kind: "leaf", value: 3 } }, right: { kind: "pair", left: { kind: "leaf", value: 4 }, right: { kind: "leaf", value: 5 } } };
let t = 0; for (let i = 0; i < 1000; i++) t += weigh(tree); console.log(t);
