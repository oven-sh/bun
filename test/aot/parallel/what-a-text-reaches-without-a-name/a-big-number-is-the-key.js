// A bigint as a key finds an element, and Link takes it for a key that nobody knows.
const list = JSON.parse("[5,6,7]");
console.log(list[1n], list[-1n] ?? "nothing");
