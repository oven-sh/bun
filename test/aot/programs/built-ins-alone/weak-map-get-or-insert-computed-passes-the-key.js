const key = { name: 1.5 };
const notes = new WeakMap();
console.log(notes.getOrInsertComputed(key, passed => passed.name + 1), notes.get(key) + 1);
