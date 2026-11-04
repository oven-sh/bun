// `next` is laid on the object that Object.getPrototypeOf gives for a generator, between two steps that are written by hand, on that generator and on one that was made before.
function* count(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
function deed(replaces: boolean) {
  const older = count(2);
  const g = count(3);
  const a = g.next();
  if (replaces) Object.getPrototypeOf(g).next = () => ({ value: "replaced", done: false });
  const b = g.next();
  const c = older.next();
  return show(a) + " " + show(b) + " " + show(c);
}
console.log(deed(false));
for (let i = 0; i < 3; i++) console.log(deed(false));
console.log(deed(true));
console.log(deed(false));
delete Object.getPrototypeOf(count(0)).next;
console.log(deed(false));
