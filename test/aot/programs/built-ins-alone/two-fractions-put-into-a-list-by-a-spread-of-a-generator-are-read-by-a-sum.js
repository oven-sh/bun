function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
let total = 0;
for (let index = 0; index < held.length; index++) total += held[index];
console.log(total);
