// `next` is called by hand on a generator on which a `next` of its own was defined, or whose prototype was moved, between two steps.
function* count(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
function ownNext() {
  const g = count(3);
  const a = g.next();
  Object.defineProperty(g, "next", { value: () => ({ value: "own", done: false }) });
  return show(a) + " " + show(g.next());
}
function movedPrototype() {
  const g = count(3);
  const a = g.next();
  Object.setPrototypeOf(g, { next: () => ({ value: "moved", done: true }) });
  return show(a) + " " + show(g.next());
}
function deed() {
  return ownNext() + " | " + movedPrototype();
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
