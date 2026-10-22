const held = new Map();
held.set(1.5, "a");
held.set(undefined, "b");
const list = [...held.keys()];
console.log(list.length);
console.log(list[0] + 1, list[1] === undefined);
