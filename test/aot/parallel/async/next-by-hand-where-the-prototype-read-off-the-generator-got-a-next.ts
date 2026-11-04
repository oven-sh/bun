// `next` is laid on the object that a read of `__proto__` off a generator gives, between two steps that are written by hand. Nobody names the generator function's `prototype`, and the generator itself is handed to nobody.
function* count(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
function deed(replaces: boolean) {
  const g = count(3);
  const a = g.next();
  if (replaces) (g as any).__proto__.next = () => ({ value: "replaced", done: false });
  const b = g.next();
  const c = g.next();
  return show(a) + " " + show(b) + " " + show(c);
}
console.log(deed(false));
for (let i = 0; i < 3; i++) console.log(deed(false));
console.log(deed(true));
console.log(deed(false));
delete (count(0) as any).__proto__.next;
console.log(deed(false));
