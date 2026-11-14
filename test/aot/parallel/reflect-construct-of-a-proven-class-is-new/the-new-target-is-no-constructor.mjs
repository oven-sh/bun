class P { constructor(x) { this.x = x; } }
const out = [];
for (const target of [() => 1, 5, null, undefined, {}]) { try { out.push(Reflect.construct(P, [1], target).x); } catch (e) { out.push(e.name + ": " + e.message); } }
console.log(out.join(" | "));
