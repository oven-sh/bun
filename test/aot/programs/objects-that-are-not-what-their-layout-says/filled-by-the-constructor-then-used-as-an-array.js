// The generic methods of arrays store, delete and count on an object whose constructor filled `length`.
function List(length) {
  this.length = length;
  this.first = 0;
  this.name = "list";
}
function describe(list) {
  return list.length + " " + list.first + " " + list.name + " " + (list.length | list.first) + " " + Object.keys(list).join();
}
const made = [];
for (let i = 0; i < 30; i++) made.push(new List(i % 3));
let total = 0;
for (const list of made) total += describe(list).length;
console.log(total);
console.log(Array.prototype.push.call(made[1], "a", "b"), describe(made[1]));
console.log(Array.prototype.pop.call(made[1]), describe(made[1]));
console.log(Array.prototype.shift.call(made[2]), describe(made[2]));
console.log(Array.prototype.splice.call(made[4], 0, 1, "x", "y").length, describe(made[4]));
made[5].length = 2 ** 32;
console.log(describe(made[5]));
made[6].length = "2";
console.log(Array.prototype.push.call(made[6], "c"), describe(made[6]));
delete made[7].length;
console.log(Array.prototype.push.call(made[7], "d"), describe(made[7]));
console.log(Array.from(made[1]).join(), Array.prototype.join.call(made[4]));
