class List extends Array {}
function Other() {
  this.length = 100;
}
Other.prototype = Object.create(List.prototype);

let sum = 0;
let arrays = 0;
for (let i = 0; i < 20000; i++) {
  const either = i % 3 ? new Other() : Reflect.construct(List, [], Other);
  sum += either.length;
  if (Array.isArray(either)) arrays++;
  sum += either.push(i) + either.length;
  either[2] = i;
  sum += either.length + either[2];
}
console.log(sum, arrays);
