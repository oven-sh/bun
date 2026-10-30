// globalThis.onmessage and globalThis.onerror: native code answers a read and takes a store, and a descriptor shows a data property.
const a = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
console.log("onmessage", "get" in a, "value" in a, a.writable, typeof a.get, typeof a.set, a.value);
const b = Object.getOwnPropertyDescriptor(globalThis, "onerror");
console.log("onerror", "get" in b, "value" in b, b.writable, typeof b.get, b.value);
console.log(typeof globalThis.__lookupGetter__("onmessage"), typeof globalThis.__lookupSetter__("onerror"), Reflect.getOwnPropertyDescriptor(globalThis, "onmessage").enumerable);
onmessage = function handler() {};
console.log(typeof onmessage, typeof globalThis.onmessage, onmessage?.name, typeof Object.getOwnPropertyDescriptor(globalThis, "onmessage").value);
onmessage = 5;
console.log(onmessage, globalThis.onmessage);
onerror = null;
console.log(onerror, Object.keys(Object.getOwnPropertyDescriptor(globalThis, "onerror")).join());
