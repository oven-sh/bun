let hits = 0;
class K { constructor() { this.n = 1; } }
function T() {}
const bound = new Proxy(T, { get(target, key, receiver) { if (key === "prototype") hits++; return Reflect.get(target, key, receiver); } });
const made = Reflect.construct(K, [], bound);
console.log(hits, made.n, made instanceof T);
