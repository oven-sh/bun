const all = JSON.parse("[0,1,2,3,4,5,6]").map((n) => [class A { constructor(x) { this.x = x; } }, () => 1, undefined, null, 7, { x: 1 }, Math.max][n]);
const out = [];
for (let i = 0; i < all.length; i++) { try { out.push(String(Reflect.construct(all[i], [i]).x)); } catch (e) { out.push(e.constructor.name + ": " + e.message); } }
console.log(out.join(" | "));
