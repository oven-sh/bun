function either(n: number): number | string {
  return n > 1 ? n : "one";
}

class Box {
  constructor(public held: number) {}
}

class Crate {
  constructor(
    public held: string,
    public more: Box | undefined,
  ) {}
}

function boxed(n: number): Box | Crate {
  return n > 1 ? new Box(n) : new Crate("crate", n > 0 ? new Box(-n) : undefined);
}

type Row = { k: "a"; a: number } | { k: "b"; b: string };

function row(n: number): Row {
  return n > 1 ? { k: "a", a: n } : { k: "b", b: "b" + n };
}

const seen: unknown[] = [];

function least(x: any, y: any) {
  let z = y;
  return x < z ? x : z;
}

function readFirst(n: number) {
  let held = either(n);
  seen.push(held);
  if (typeof held !== "string") {
    const narrowed = held;
    seen.push(narrowed + 1);
    held = narrowed;
  }
  return held;
}

function throughTwo(n: number) {
  let held = either(n);
  seen.push(held);
  for (let i = 0; i < 3; i++) {
    if (typeof held === "number") {
      const first = held;
      const second = first;
      seen.push(second * 2);
      held = i === 1 ? "stopped" : second + 1;
    }
  }
  return held;
}

function ofClasses(n: number) {
  let held = boxed(n);
  seen.push(held.held);
  while (held instanceof Crate) {
    const crate = held;
    const inner = crate.more;
    seen.push(crate.held.length);
    if (!inner) break;
    held = inner;
  }
  return held.held;
}

function ofRows(n: number) {
  let held = row(n);
  seen.push(held.k);
  if (held.k === "a") {
    const narrowed = held;
    const list = [narrowed];
    seen.push(list[0].a);
    held = narrowed;
  } else {
    const { field } = { field: held };
    seen.push(field.b);
    held = field;
  }
  return held;
}

function byAClosure(n: number) {
  let held = either(n);
  const read = () => held;
  seen.push(read());
  if (typeof held === "number") {
    const narrowed = held;
    const again = (value = narrowed) => value;
    seen.push(again() + 1);
    held = again();
  }
  return read();
}

for (const n of [0, 1, 2, 3]) {
  console.log(n, readFirst(n), throughTwo(n), ofClasses(n), JSON.stringify(ofRows(n)), byAClosure(n));
}
console.log(JSON.stringify(seen), least(2, 1), least("a", "b"));
