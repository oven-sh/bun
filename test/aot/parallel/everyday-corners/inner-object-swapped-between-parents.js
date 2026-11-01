// Inner object swapped between parents: compiled answers as plain.
function make(i) {
  return { id: i, pos: { x: i } };
}
const a = make(1),
  b = make(2);
[a.pos, b.pos] = [b.pos, a.pos];
a.pos.x += 10;
console.log(a.pos.x, b.pos.x, JSON.stringify([a, b]));
