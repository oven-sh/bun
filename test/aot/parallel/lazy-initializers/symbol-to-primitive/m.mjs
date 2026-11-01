function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const n = { [Symbol.toPrimitive]() { console.log("toPrimitive runs"); return 2; } };
const o = { twice: n * 2, big: make("x") };
export const read = () => o;
