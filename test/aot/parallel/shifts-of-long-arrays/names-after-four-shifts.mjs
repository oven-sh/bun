// Names on an array whose start has moved by a few slots.
const view = new Uint8Array(40);
for (let i = 0; i < 40; i++) view[i] = i;
const kept = [];
let shown = "";
function deal(shifts, named) {
  for (let k = 0; k < 40; k++) {
    const a = [...view, k];
    for (let j = 0; j < shifts; j++) a.shift();
    a.foo = k;
    if (named > 1) a.bar = "b" + k;
    if (named > 2) {
      a.third = [k];
      a.fourth = k / 2;
      a.fifth = { k };
    }
    kept.push(a);
  }
  Bun.gc(true);
  const last = kept[kept.length - 1];
  shown += `${shifts} ${named} ${last.length} ${last[0]} ${last[last.length - 1]} ${last.foo} ${last.bar} ${last.fifth?.k} ${Object.keys(last).length}\n`;
}
for (let shifts = 0; shifts < 9; shifts++) for (let named = 1; named < 4; named++) deal(shifts, named);
let sum = 0;
for (const a of kept) {
  for (const v of a) sum += v;
  sum += a.foo + (a.fourth ?? 0) + (a.third?.[0] ?? 0);
}
Bun.gc(true);
for (const a of kept) {
  while (a.length) sum += a.pop() * 3 + (a.length > 2 ? a.shift() : 0);
  a.push(a.foo, 7);
  a.unshift(1);
  delete a.foo;
  a.foo = sum % 100;
}
Bun.gc(true);
for (const a of kept) sum += a.length * 1000 + a.foo + a[0];
console.log(shown + sum, kept.length);
