// One read sees thousands of objects that hold a string under a name before it sees the object that got a number there under a key that only the run knows. Then the value goes back and forth.
const names = JSON.parse('["late"]');
function record(i) {
  return { x: i, y: i + 1 };
}
function lengthOf(o) {
  return o.late.length;
}
const many = [];
for (let i = 0; i < 2000; i++) {
  const o = record(i);
  o.late = "t" + i;
  many.push(o);
}
let total = 0;
for (const o of many) total += lengthOf(o);
const odd = record(-1);
odd[names[0]] = 5;
console.log(total, lengthOf(odd));
odd[names[0]] = "again a string";
console.log(lengthOf(odd), Object.keys(odd).join());
odd[names[0]] = null;
try {
  lengthOf(odd);
} catch (e) {
  console.log(e.constructor.name);
}
odd.late = "by name";
console.log(lengthOf(odd), JSON.stringify(odd));
many[7][names[0]] = 7.5;
many[8][names[0]] = [1, 2, 3];
total = 0;
for (const o of many) {
  const n = lengthOf(o);
  total += n === undefined ? 1000 : n;
}
console.log(total, JSON.stringify(many[7]), JSON.stringify(many[8]));
