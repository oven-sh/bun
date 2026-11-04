// `next` is called by hand on a generator that nobody else has: before the first step comes return() or throw(), in the middle, and behind the end.
const log: string[] = [];
function* count(n: number): Generator<number, string, unknown> {
  try {
    for (let i = 0; i < n; i++) log.push("sent " + String(yield i));
    return "over";
  } finally {
    log.push("finally");
  }
}
const show = (r: IteratorResult<unknown, unknown>) => String(r.value) + ":" + String(r.done);
function returnedFirst() {
  const g = count(2);
  return [show(g.return("early")), show(g.next()), show(g.next())].join(" ");
}
function thrownFirst() {
  const g = count(2);
  try {
    g.throw(new Error("before the first step"));
    return "not thrown";
  } catch (e) {
    return (e as Error).message + " " + show(g.next());
  }
}
function returnedInTheMiddle() {
  const g = count(3);
  return [show(g.next("a")), show(g.next("b")), show(g.return("middle")), show(g.next("c"))].join(" ");
}
function behindTheEnd() {
  const g = count(1);
  return [show(g.next()), show(g.next()), show(g.next()), show(g.next())].join(" ");
}
function deed() {
  return [returnedFirst(), thrownFirst(), returnedInTheMiddle(), behindTheEnd()].join(" | ");
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
console.log(log.join(" | "));
