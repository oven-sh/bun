// A loop reads a field under a condition that fails for an object whose field was deleted.
interface Holder<T> {
  value: T;
  q: number;
}

let sink: unknown = null;

function lengths(o: Holder<string>, flag: boolean): number {
  let s = o.q;
  for (let i = 0; i < 6; i++) {
    if (flag) {
      sink = { i };
      s += o.value.length;
    }
  }
  return s;
}

function sizes(o: Holder<Map<number, number>>): number {
  let s = o.q;
  for (let i = 0; i < 6; i++) if ("value" in o) s += o.value.size;
  return s;
}

function firsts(o: Holder<number[]>, flag: boolean): number {
  let s = o.q;
  for (let i = 0; i < 6; i++) {
    if (!flag) break;
    s += o.value[0];
  }
  return s;
}

function load(o: Holder<{ v: number }>) {
  return o.value;
}

function fields(o: Holder<{ v: number }>, flag: boolean): number {
  let s = o.q;
  for (let i = 0; i < 6; i++) if (flag) s += load(o).v;
  return s;
}

function optional(o: { value?: { v: number }; q: number }): number {
  let s = o.q;
  for (let i = 0; i < 6; i++) if (o.value !== undefined) s += o.value.v;
  return s;
}

class Counter {
  step = { v: 2 };
  q = 1;
  sum(flag: boolean): number {
    let s = this.q;
    for (let i = 0; i < 6; i++) if (flag) s += this.step.v;
    return s;
  }
}

function twice(o: Holder<{ v: number }>): number {
  let s = 0;
  for (let i = 0; i < 3; i++) if (o.q > 0) s += o.value.v;
  delete (o as any).value;
  o.q = 0;
  for (let i = 0; i < 3; i++) if (o.q > 0) s += o.value.v;
  o.value = { v: 10 };
  o.q = 1;
  for (let i = 0; i < 3; i++) if (o.q > 0) s += o.value.v;
  return s;
}

function withoutValue<T extends object>(o: T): T {
  delete (o as any).value;
  return o;
}

for (let r = 0; r < 4; r++) {
  console.log(lengths({ value: "abcd", q: r }, true), lengths(withoutValue({ value: "abcd", q: r }), false), typeof sink);
  console.log(sizes({ value: new Map([[1, 2]]), q: r }), sizes(withoutValue({ value: new Map([[1, 2]]), q: r })));
  console.log(firsts({ value: [4, 5], q: r }, true), firsts(withoutValue({ value: [4, 5], q: r }), false));
  console.log(fields({ value: { v: 3 }, q: r }, true), fields(withoutValue({ value: { v: 3 }, q: r }), false));
  console.log(optional({ value: { v: 3 }, q: r }), optional({ q: r }), optional(withoutValue({ value: { v: 3 }, q: r })));
  const counter = new Counter();
  console.log(counter.sum(true));
  delete (counter as any).step;
  console.log(counter.sum(false));
  try {
    console.log(counter.sum(true));
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
  console.log(twice({ value: { v: 1 }, q: 1 }));
}
