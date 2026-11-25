const bytes = new Uint8Array([5, 6]);
let holder = bytes, described;
while (holder && !(described = Object.getOwnPropertyDescriptor(holder, "at"))) holder = Object.getPrototypeOf(holder);
console.log(typeof described.value, Reflect.apply(described.value, bytes, [1]), holder === Object.getPrototypeOf(Uint8Array.prototype));
