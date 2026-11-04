const above = Object.freeze({ kind: "above" });
const E = Object.create(above);
E.kind = "own"; E.other = 1;
console.log(E.kind, E.other, Object.keys(E).join());
