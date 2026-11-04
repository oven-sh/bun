// `next` is laid on the object under `prototype` of a generator function, between two steps that are written by hand: every generator that stands below that object finds the new one, and finds the engine's again once it is deleted.
function* count(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
function deed(replaces: boolean) {
  const g = count(3);
  const a = g.next();
  if (replaces) (count as any).prototype.next = () => ({ value: "replaced", done: false });
  const b = g.next();
  const c = g.next();
  return show(a) + " " + show(b) + " " + show(c);
}
console.log(deed(false));
for (let i = 0; i < 3; i++) console.log(deed(false));
console.log(deed(true));
console.log(deed(false));
delete (count as any).prototype.next;
console.log(deed(false));
