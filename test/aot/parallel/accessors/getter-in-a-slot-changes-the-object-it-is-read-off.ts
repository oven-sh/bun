// A getter that a literal has laid in the place of a field changes the object while it runs: what is read behind the call sees the change.
type Counter = { n: number; readonly next: number };
function make(): Counter {
  return {
    n: 0,
    get next() {
      this.n += 1;
      (this as any).extra = this.n;
      return this.n;
    },
  };
}
function deed(counter: Counter) {
  const before = counter.n;
  const first = counter.next;
  const between = counter.n;
  const second = counter.next;
  return [before, first, between, second, counter.n, Object.keys(counter).join()].join(" ");
}
console.log(deed(make()));
const kept = make();
let last = "";
for (let i = 0; i < 300; i++) last = deed(kept);
console.log(last);
