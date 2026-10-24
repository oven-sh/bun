// One object of a layout gets a name as a string by a direct store, another gets it as a number under a key that only the run knows. Hot functions read the name from both and use it as a string.
const names = JSON.parse('["late"]');
function record(i) {
  return { x: i, y: i + 1 };
}
function lengthOf(o) {
  return o.late.length;
}
function suffixed(o) {
  return o.late + "!";
}
function kindOf(o) {
  return typeof o.late;
}
const first = record(1);
first[names[0]] = 5;
const second = record(2);
second.late = "text";
let lengths = 0;
let kinds = "";
let text = "";
for (let i = 0; i < 20000; i++) {
  const o = i & 1 ? first : second;
  const length = lengthOf(o);
  lengths += length === undefined ? 100 : length;
  if (i < 4) {
    kinds += kindOf(o) + ",";
    text += suffixed(o) + ",";
  }
}
console.log(lengths, kinds, text);
console.log(first.late, second.late, Object.keys(first).join(), Object.keys(second).join());
console.log(JSON.stringify(first), JSON.stringify(second));
