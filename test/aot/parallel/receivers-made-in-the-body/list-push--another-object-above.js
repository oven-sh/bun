const unseen = (x) => [x][JSON.parse("0")];
const said = [];
const above = Object.create(Array.prototype);
above.push = function (...given) { said.push("push"); return Array.prototype.push.apply(this, given); };
class Shelf {
  constructor(parent) {
    const made = [];
    Object.setPrototypeOf(made, parent);
    return made;
  }
}
function gather(n, change) {
  const result = new Shelf(above);
  let sum = 0;
  for (let k = 0; k < n; k++) sum += String(result.push(change(k))).length;
  said.push(sum);
  return result;
}
const changes = [(k) => k, (k) => k * 2];
let kept = null;
for (let round = 0; round < 12; round++) kept = unseen(gather(3, changes[round % 2]));
console.log(said.slice(-8).join(","), typeof kept);
