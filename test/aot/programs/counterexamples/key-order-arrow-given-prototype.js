// A `prototype` stored on an arrow function is listed in the order of the stores.
const f = () => 1;
f.prototype = f.a = 1;
console.log(Reflect.ownKeys(f).join());
