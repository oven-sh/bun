// One object of a layout is stored to by name through a value nobody knows, with another type than the objects stored to directly. Only JSON.stringify, Object.keys and Object.values look at the objects.
const C = structuredClone({}).constructor;
function record(i) {
  return { x: i, y: i + 1 };
}
function store(o) {
  o.late = { deep: true };
}
const first = record(1);
store(C(first));
const second = record(2);
second.late = "text";
const third = record(3);
third.late = "more";
let total = 0;
let out = "";
for (let i = 0; i < 3000; i++) {
  const o = i % 3 === 0 ? first : i % 3 === 1 ? second : third;
  const s = JSON.stringify(o);
  total += s.length;
  if (i < 3) out += s + Object.keys(o).join() + Object.values(o).length + ";";
}
console.log(total, out);
