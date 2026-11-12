// The loop climbs from the typed array to %TypedArray%.prototype and takes `at` out of its descriptor there. `at` is text of the library, and nothing here reads it by a name.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const bytes = new Uint8Array([1, 2]);
let holder = bytes;
let described;
while (holder && !(described = Object.getOwnPropertyDescriptor(holder, "at"))) holder = Object.getPrototypeOf(holder);
console.log(Reflect.apply(described.value, bytes, [1]));
