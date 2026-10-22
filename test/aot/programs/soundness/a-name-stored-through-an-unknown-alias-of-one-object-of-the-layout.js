// Two objects of one layout get the same name: one a string by a direct store, the other a number by a store through a value nobody knows that is that object.
const C = structuredClone({}).constructor;
function record(i) {
  return { x: i, y: i + 1 };
}
function text(o) {
  return JSON.stringify(o);
}
const first = record(1);
C(first).late = 5;
const second = record(2);
second.late = "text";
console.log(first.late, second.late, Object.keys(first).join(), Object.keys(second).join());
console.log(text(first), text(second));
let total = 0;
for (let i = 0; i < 10000; i++) total += text(i & 1 ? first : second).length;
console.log(total);
