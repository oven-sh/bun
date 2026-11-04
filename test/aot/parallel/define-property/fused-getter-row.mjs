function f(r) { return Reflect.get(r, "extra"); }
const o = [];
f(new Proxy({}, {}));
Object.defineProperties(Array.prototype, Object.getOwnPropertyDescriptors({ get extra() { return 41; } }));
o.push(f([1, 2]));
console.log(o.join(" "));
