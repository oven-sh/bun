// A slot for numbers also says undefined and null. A read by name of an object that nobody follows meets every state of it.
class C {
  n;
  d;
  m = null;
  constructor(i) {
    if (i & 1) this.n = i;
    if (i & 2) this.d = i + 0.5;
    if (i & 4) this.m = i;
  }
}
C.prototype.inherited = "on the prototype";
const hide = Function("value", "return value");
const all = [];
for (let i = 0; i < 8; i++) all.push(new C(i));
all[5].n = undefined;
all[6].d = null;
all[7].m = undefined;
delete all[3].n;
delete all[3].d;
all[4].n = "now text";
all[2].d = NaN;
all[1].n = 2147483647;
all[0].d = -0;
const list = hide(all);
function read(item) {
  return [item.n, item.d, item.m].map(value => (Object.is(value, -0) ? "-0" : value === undefined ? "undefined" : String(value))).join(" ");
}
function sum(item) {
  return (item.n ?? 1) + (item.d ?? 2) + (item.m ?? 4);
}
let total = "";
for (let round = 0; round < 3000; round++) {
  let row = 0;
  for (const item of list) {
    const value = sum(item);
    if (typeof value === "number" && value === value) row += value;
  }
  total = row;
}
console.log(total);
for (const item of list) console.log(read(item), Object.keys(item).join(), "n" in item, "d" in item);
C.prototype.n = "inherited n";
console.log(read(list[3]));
delete C.prototype.n;
Object.freeze(list[0]);
console.log(read(list[0]));
