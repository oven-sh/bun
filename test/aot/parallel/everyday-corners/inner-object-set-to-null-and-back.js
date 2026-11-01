// Inner object set to null and back: compiled answers as plain.
function make(i) {
  return { id: i, pos: { x: i } };
}
const list = [make(1), make(2), make(3)];
list[1].pos = null;
console.log(list.map(o => o.pos?.x ?? "none").join());
list[1].pos = list[0].pos;
list[0].pos.x = 7;
console.log(list.map(o => o.pos?.x ?? "none").join());
