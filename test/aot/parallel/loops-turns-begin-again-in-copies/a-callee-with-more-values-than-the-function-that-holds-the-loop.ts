// The callee has more values than the function that holds the loop, and what is expected of a late value of it goes by values that are not built while the loop is looked at.
type Inner = { value: number; more: number };
type Box = { a: Inner; b: Inner; c: Inner; d: Inner; e: Inner; f: Inner };
type Holder = { box: Box };
type Table = { scale: number };
function weigh(box: Box): number {
  const first = box.a.value + box.a.more;
  const second = box.b.value + box.b.more;
  const third = box.c.value + box.c.more;
  const fourth = box.d.value + box.d.more;
  const fifth = box.e.value + box.e.more;
  const sixth = box.f.value + box.f.more;
  return first + second + third + fourth + fifth + sixth;
}
function run(table: Table, holder: Holder): number { let total = 0; for (let i = 0; i < 1000; i++) total += weigh(holder.box) * table.scale; return total; }
function main() {
  const make = (n: number): Inner => ({ value: n, more: n + 1 });
  const holder: Holder = { box: { a: make(1), b: make(2), c: make(3), d: make(4), e: make(5), f: make(6) } };
  (globalThis as any).held = [holder, holder.box, holder.box.a, weigh, run];
  (0, eval)("1");
  console.log(run({ scale: 2 }, holder));
}
main();
