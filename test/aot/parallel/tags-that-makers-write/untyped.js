function area(x) { if (x.kind === "circle") return x.r * 3; if (x.kind === "square") return x.s * x.s; return "none:" + x.kind; }
function total(e) { if (e.kind === "num") return e.value; if (e.kind === "add") return total(e.left) + total(e.right); return -total(e.inner); }
const tree = { kind: "add", left: { kind: "neg", inner: { kind: "num", value: 3 } }, right: { kind: "add", left: { kind: "num", value: 4 }, right: { kind: "num", value: 5 } } };
const odd = { kind: "num", value: 1 }; odd.kind = "neg"; odd.inner = { kind: "num", value: 9 };
for (let round = 0; round < 3; round++) console.log(area({ kind: "circle", r: 2 }), area({ kind: "square", s: 3 }), area({ kind: "none" }), area({ kind: "circle", s: 3 }), total(tree), total(odd), total({ kind: "add", left: odd, right: tree }));
