const target = Object.defineProperties({}, Object.getOwnPropertyDescriptors(URLSearchParams.prototype));
try { console.log(new Proxy(target, { get: (object, key, receiver) => Reflect.get(object, key, receiver) })); } catch (error) { console.log(error.name, error.message); }
console.log("after");
