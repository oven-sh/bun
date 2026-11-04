// `next` is stored on the generator itself, by a plain store, between two steps that are written by hand: that generator finds its own, which hands out one and the same object each time, and every other generator finds the engine's.
function* count(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
const always = { value: "own", done: false, extra: "kept" };
function deed(stores: boolean) {
  const other = count(2);
  const g = count(3);
  const a = g.next();
  if (stores) (g as any).next = () => always;
  const b = g.next();
  const c = g.next();
  return [show(a), show(b), show(c), String(b === c), String((b as any).extra), Object.keys(b).join(), show(other.next())].join(" ");
}
console.log(deed(false));
for (let i = 0; i < 3; i++) console.log(deed(false));
console.log(deed(true));
console.log(deed(false));
for (let i = 0; i < 4; i++) console.log(deed(i % 2 === 1));
