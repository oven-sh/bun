// A frozen list with a hole: the native takes the protocol.
const list = Object.freeze([6, , 6]);
console.log(new Set(list).size);
