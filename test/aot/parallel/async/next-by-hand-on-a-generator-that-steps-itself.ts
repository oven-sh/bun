// A generator steps itself through a closure while it runs: the inner `next` throws a TypeError, and the outer step goes on.
function* selfish(step: () => unknown): Generator<string, string, unknown> {
  let said = "nothing";
  try {
    step();
  } catch (e) {
    said = (e as Error).name;
  }
  yield said;
  return "over";
}
function deed() {
  const g: Generator<string, string, unknown> = selfish(() => g.next());
  const a = g.next();
  const b = g.next();
  return String(a.value) + ":" + String(a.done) + " " + String(b.value) + ":" + String(b.done);
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
