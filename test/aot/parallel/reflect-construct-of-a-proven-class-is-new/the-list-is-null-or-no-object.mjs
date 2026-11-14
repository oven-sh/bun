class P { constructor(x) { this.x = x; } }
const out = [];
for (const list of [null, undefined, 5, "ab", Symbol.iterator]) { try { out.push(Reflect.construct(P, list).x); } catch (e) { out.push(e.name + ": " + e.message); } }
console.log(out.join(" | "));
