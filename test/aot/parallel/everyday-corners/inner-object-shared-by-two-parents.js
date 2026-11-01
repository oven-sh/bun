// Inner object shared by two parents: compiled answers as plain.
const pos = { x: 1 };
const a = { pos },
  b = { pos };
a.pos.x = 5;
console.log(b.pos.x, a.pos === b.pos, JSON.stringify([a, b]));
