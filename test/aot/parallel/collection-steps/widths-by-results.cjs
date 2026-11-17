// STATISTIC: CollectionWidthsByResults >= 3
// The elements of these are proven though the type of the collection does not say so. A set may hold undefined alone, and a map may get other keys while it is stepped.
const numbers = new Set([1, 2, 3, 4]);
const names = new Set(["a", "b", "c"]);
const table = new Map([[1, "x"], [2, "y"], [3, "z"]]);
const holes = new Set([, 5, , 7]);
const onlyHole = new Set([,]);
function total(turns) {
  let sum = 0;
  for (let k = 0; k < turns; k++) {
    for (const x of numbers) sum += x;
    for (const x of holes) sum += x === undefined ? 100 : x;
    for (const x of onlyHole) sum += x === undefined ? 1000 : 0;
  }
  return sum;
}
function text(turns) {
  let made = "";
  for (let k = 0; k < turns; k++) {
    for (const x of names) made += x;
    for (const [key, value] of table) made += key + value;
  }
  return made;
}
console.log(total(3), text(2));
numbers.add(2.5);
numbers.delete(1);
names.delete("b");
names.add("long name");
console.log(total(3), text(2));
numbers.clear();
console.log(total(2));
