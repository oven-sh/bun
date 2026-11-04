// A generator is handed to text that nobody has seen, between two steps that are written by hand. The text lays a `next` on it, steps it, or only looks.
const lays = Function("g", process.argv[9] ?? "g.next = () => ({ value: 'laid by unseen code', done: false });");
const steps = Function("g", process.argv[10] ?? "return g.next().value;");
const looks = Function("g", process.argv[11] ?? "return typeof g.next;");
function* count(n: number) {
  for (let i = 0; i < n; i++) yield i;
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
function deed(unseen: Function | null) {
  const g = count(4);
  const a = g.next();
  const said = unseen ? String(unseen(g)) : "not handed out";
  const b = g.next();
  const c = g.next();
  return [show(a), said, show(b), show(c)].join(" ");
}
console.log(deed(null));
for (let i = 0; i < 3; i++) console.log(deed(null));
console.log(deed(looks));
console.log(deed(steps));
console.log(deed(lays));
console.log(deed(null));
