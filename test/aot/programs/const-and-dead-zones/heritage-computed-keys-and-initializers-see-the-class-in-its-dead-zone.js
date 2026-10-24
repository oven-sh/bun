// Class heritage, computed keys, field initializers run while the class binding is in its dead zone.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
console.log(attempt(() => { class A extends (attempt(() => A.x), Object) { static x = 1; } return "made"; }));
console.log(attempt(() => { class A { [attempt(() => A.name)]() {} } return Object.getOwnPropertyNames(A.prototype).join(); }));
let hook;
console.log(attempt(() => { class A { static [(hook = () => A.z.q, "k")] = attempt(hook); static z = { q: 1 }; } return A.k; }));
const r = attempt(() => Later.z.q);
class Later { static z = { q: 1 }; }
console.log(r);
