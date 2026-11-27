// Elements that the turns of an unrolled loop add up are asked for holes behind all turns: where a later turn leaves in the middle at a hole of another read, the turns run again.
function both(v) {
  let a = 0, b = 0, turns = 0;
  for (let i = 0; i < v.length; i++) { a += v[i]; b += v[i - 2]; turns++; }
  return a + " " + b + " " + turns;
}
const v = [];
for (let i = 0; i < 40; i++) v.push(i * 3);
delete v[9];
console.log(both(v));
