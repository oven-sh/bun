// Object.assign and spread bring parsed data onto literal objects. Another object of the same layout gets one of the names by a direct store, with another type.
const input = JSON.parse('{"late": 5, "x": "seven"}');
function record(i) {
  return { x: i, y: i + 1 };
}
function describe(o) {
  return typeof o.late + ":" + typeof o.x + ":" + typeof o.y + ":" + Object.keys(o).join("+") + ":" + JSON.stringify(o);
}
const plain = record(1);
plain.late = "text";
const assigned = Object.assign(record(2), input);
const spread = { ...record(3), ...input };
const spreadFirst = { ...input, x: 1, y: 2 };
spreadFirst.late = "text";
const literalWithSpread = { x: 1, y: 2, ...input };
console.log(describe(plain));
console.log(describe(assigned));
console.log(describe(spread));
console.log(describe(spreadFirst));
console.log(describe(literalWithSpread));
let total = 0;
for (let i = 0; i < 10000; i++) {
  const o = i % 3 === 0 ? plain : i % 3 === 1 ? assigned : literalWithSpread;
  total += typeof o.late === "string" ? o.late.length : o.late;
  total += typeof o.x === "number" ? o.x : o.x.length;
}
console.log(total);
