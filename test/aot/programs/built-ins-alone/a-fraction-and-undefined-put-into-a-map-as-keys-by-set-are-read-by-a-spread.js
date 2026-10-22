const held = new Map();
held.set(1.5, "a");
held.set(undefined, "b");
const list = [...held];
console.log(list[0][0] + 1, list[1][0] === undefined);
