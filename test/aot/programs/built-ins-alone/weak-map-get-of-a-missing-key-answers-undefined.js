const key = {};
const notes = new WeakMap([[key, 1.5]]);
const missing = notes.get({});
console.log(missing === undefined, typeof missing, notes.get(key) + 1);
