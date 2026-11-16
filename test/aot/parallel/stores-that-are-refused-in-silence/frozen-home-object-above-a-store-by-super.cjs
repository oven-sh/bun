const above = Object.freeze({ kind: "above" });
const E = { __proto__: above, fill() { super.kind = "own"; return this.kind; } };
console.log(E.fill(), Object.keys(E).join());
