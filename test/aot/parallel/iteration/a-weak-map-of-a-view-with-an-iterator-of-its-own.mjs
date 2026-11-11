const k = {}, v = new Float64Array(1);
v[Symbol.iterator] = function* () { yield* [[k, 0.5]]; };
console.log(new WeakMap(v).get(k) + 1);
