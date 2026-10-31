// Inner object replaced while aliased: compiled answers as plain.
function make(i) {
  return { id: i, pos: { x: i, y: i + 1 } };
}
const o = make(1),
  old = o.pos;
o.pos = { x: 10, y: 20 };
old.x = 99;
console.log(o.pos.x, old.x, o.pos === old, JSON.stringify(o));
