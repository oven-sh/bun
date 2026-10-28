// A definition makes the length of a built-in function enumerable. Object.values and Object.entries then list it.
console.log(Reflect.defineProperty(Math.max, "length", { enumerable: true }));
const values = Object.values(Math.max);
console.log(values.length, typeof values.at(-1), values.at(-1));
const entries = Object.fromEntries(Object.entries(Math.max));
console.log(Object.keys(entries).join(), typeof entries.length, entries.length);
