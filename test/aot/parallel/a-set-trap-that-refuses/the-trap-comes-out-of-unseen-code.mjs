// A store that returns files its pair, a store that throws does not: so the same statement goes by the run time's own road first and by the stub's road later. Both say the same.
function store(o, k, v) { try { o[k] = v; return "stored"; } catch (e) { return e.constructor.name + ": " + e.message; } }
const trap = (0, eval)("(target, key, value) => value !== 2");
function picky() { return new Proxy(function () {}, { set: trap }); }
const texts = [];
for (const value of [2, 2, 1, 1, 1, 2, 2]) texts.push(store(picky(), Symbol.iterator, value));
console.log(texts.join("\n"));
