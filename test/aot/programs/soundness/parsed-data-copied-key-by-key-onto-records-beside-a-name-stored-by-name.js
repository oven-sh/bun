// Parsed data is copied key by key onto literal objects. Another object of the same layout gets one of the names by a direct store, with another type.
const input = JSON.parse('{"late": 5, "x": "seven", "other": [1, 2]}');
function record(i) {
  return { x: i, y: i + 1 };
}
function copyOnto(target, source) {
  for (const k of Object.keys(source)) target[k] = source[k];
  return target;
}
function describe(o) {
  return typeof o.late + ":" + typeof o.x + ":" + typeof o.y + ":" + Object.keys(o).join("+");
}
const plain = record(1);
plain.late = "text";
const copied = copyOnto(record(2), input);
const both = record(3);
both.late = "first a string";
copyOnto(both, input);
console.log(describe(plain), describe(copied), describe(both));
console.log(JSON.stringify(plain), JSON.stringify(copied), JSON.stringify(both));
let total = 0;
for (let i = 0; i < 10000; i++) {
  const o = i % 3 === 0 ? plain : i % 3 === 1 ? copied : both;
  total += o.late.length === undefined ? o.late : o.late.length;
  total += typeof o.x === "number" ? o.x : o.x.length;
}
console.log(total);
