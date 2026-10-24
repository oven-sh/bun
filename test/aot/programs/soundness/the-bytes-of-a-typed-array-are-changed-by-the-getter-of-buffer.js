// The getter of `buffer` is taken out of its descriptor and called on a typed array: a store through another view of what comes back shows in the array.
const bytes = new Uint8Array([1, 2, 3]);
const getBuffer = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "buffer").get;
const b = getBuffer.call(bytes);
new Uint8Array(b)[0] = 9;
console.log(bytes[0], bytes.join());
