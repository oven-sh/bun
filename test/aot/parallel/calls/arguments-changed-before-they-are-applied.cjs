// What the fields hold where the arguments object was changed before it was passed on.
function Stored() { arguments[0] = arguments[0] + "!"; this.initialize.apply(this, arguments); }
Stored.prototype.initialize = function (value, count) { this.value = value; this.count = count; };
function sumOfStored(count) {
  const made = [];
  for (let i = 0; i < count; i++) made.push(new Stored(i, i));
  let sum = 0;
  for (const object of made) sum = sum + object.value * 2 + object.count;
  return sum + " " + made[count - 1].value.length;
}
console.log(sumOfStored(4));
