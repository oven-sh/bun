// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const target = Object.defineProperties({}, Object.getOwnPropertyDescriptors(URLSearchParams.prototype));
try { console.log(new Proxy(target, { get: (object, key, receiver) => Reflect.get(object, key, receiver) })); } catch (error) { console.log(error.name, error.message); }
console.log("after");
