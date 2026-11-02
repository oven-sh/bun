// Objects are read where they are made behind stores of what may be missing and every pass is verified.
// Flags: --aot-check=verify-each-pass
type Flat = { x: number; y: number };
type Nest = { inner: Flat; tag: string; list: number[] };
type Link = { v: number; next: Link | null };
function num(x: number): string {
  return Object.is(x, -0) ? "-0" : String(x);
}
function show(o: unknown): string {
  if (typeof o === "number") return num(o);
  if (o === null || typeof o !== "object") return String(o);
  if (Array.isArray(o)) return "[" + o.map(show).join() + "]";
  let all = o.constructor === Object ? "{" : o.constructor.name + "{";
  for (const key of Object.keys(o)) all += key + ":" + show((o as Record<string, unknown>)[key]) + ";";
  return all + "}";
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
  moved(by: number): Point {
    return new Point(this.x + by, this.y + by);
  }
  static of(x: number, y: number): Point {
    return new Point(x, y);
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
  sum(): number {
    return super.sum() + this.z;
  }
}
const kept: unknown[] = [];
let last: Flat | null = null;
const given: number[] = JSON.parse("[0, 1, 2, 3, 0.5]");
const loose: any = given;
function fail(when: boolean): void {
  if (when) throw new Error("stop");
}
function sumOf(o: Flat): number {
  return o.x + o.y;
}
function grow(o: Flat): void {
  o.x += 1;
  o.y *= 2;
}
function pick(a: Flat, b: Flat, first: boolean): Flat {
  return first ? a : b;
}
function make(x: number, y: number): Flat {
  return { x, y };
}
function turned(o: Flat): Flat {
  return { x: o.y, y: o.x };
}
function both(x: number): [Flat, Flat] {
  return [{ x, y: x + 1 }, new Point(x + 2, x + 3)];
}
function nest(x: number): Nest {
  return { inner: { x, y: x }, tag: "n", list: [x] };
}
function made1(p: number, q: number): Flat {
  let out = "";
  let a: number = q;
  let b: number = 0.5;
  let turns = 0;
  let o1: Flat = new Point(0.5, p).moved(-0);
  let o2: Flat = o1;
  const box: Nest = nest(a);
  let o3: Flat = (() => o2)();
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  o3 = turned(o3);
  kept.push({ held: o3 });
  return { x: o1.x, y: o2.y };
}
function made2(p: number, q: number): Flat {
  let out = "";
  let a: number = 1;
  let b: number = q;
  let turns = 0;
  let o1: Flat = { x: a / 2, y: 0.5 };
  let o2: Flat = Point.of(a, a);
  const box: Nest = { inner: o2, tag: "t", list: [p, a * 2] };
  let o3: Flat = new Point3(o2.x, given[1], o1.y);
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  kept.push(o2);
  return out.length > 1000 ? o1 : o3;
}
class Holder3 {
  inner = { x: 1, y: 2 };
  tag = "t";
  list: number[] = [0.5, 1];
  constructor(x: number) {
    this.inner = { x: x + 1, y: 3 };
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run1(p: number, q: number): string {
  let out = "";
  function* steps(): Generator<string, void, unknown> {
    let a: number = p + 1;
    let b: number = q;
    let turns = 0;
    const o1: Flat = Point.of(0, 0.5);
    const o2: Flat = o1;
    const box = new Holder3(a);
    const o3: Flat = pick(o1, o1, o1 === o1);
    const local: Flat[] = [];
    const many: number[] = [a, b, 1];
    const soft = many as any;
    if (o3 === o3) {
      {
        const [l, r] = both(q);
        l.x += r.y;
        out += num(l.x) + "," + num(r.x) + "," + (l === r) + " ";
      }
      out += num(box.inner.x + o3.x) + " ";
    } else {
      out += num(o1.x + o3.y) + " ";
    }
    try {
      o2.x = soft[a & 1];
      fail(o1.y !== o1.y);
      o3.x += p;
    } catch {
      {
        let head: Link | null = null;
        for (let i = 0; i < 3; i++) head = { v: 0.5 + i, next: head };
        let n = 0;
        for (let c = head; c; c = c.next) n = n * 10 + c.v;
        out += num(n) + " ";
      }
    } finally {
      out += show(box) + " ";
    }
    try {
      [o1.x, o3.x] = [o3.x, o1.x];
      fail(o2 === o3);
      if (turns === 2) kept.push(box);
    } catch {
      out += num(o1.x + o3.y) + " ";
      o2.x += a * 2;
    }
    for (let i = 0; i < 2 && turns++ < 8; i++) {
      box.inner.y += a;
      Object.assign(o2, o2);
    }
    {
      const fresh: Flat = new Point(b, p);
      fresh.x += a / 2;
      out += num(fresh.x) + "," + num(fresh.y) + " ";
    }
    out += JSON.stringify(o1) + " ";
    if (box.list.length > 1) {
      out += (o3 instanceof Point) + "," + (o3 instanceof Point3) + " ";
      {
        let head: Link | null = null;
        for (let i = 0; i < 3; i++) head = { v: a + b + i, next: head };
        let n = 0;
        for (let c = head; c; c = c.next) n = n * 10 + c.v;
        out += num(n) + " ";
      }
    } else {
      o2.y += soft[1];
      box.inner.x = loose[2];
    }
    out +=
      show(o1) + show(o2) + show(o3) + " " + show(box) + num(box.total()) + local.length + (o1 === o2) + (o2 === o3);
  }
  return [...steps()].join("") + out;
}
class Holder4 {
  inner = { x: 1, y: 2 };
  tag = "t";
  list: number[] = [];
  constructor(x: number) {
    this.inner = { x, y: x };
    this.inner.y += 1;
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run2(p: number, q: number): string {
  let out = "";
  let a: number = p + 1;
  let b: number = 0.5;
  let turns = 0;
  const o1: Flat = new Point(given[1], 7).moved(given[1]);
  const o2: Flat = o1;
  const box = new Holder4(a);
  const o3: Flat = { x: a + 1, y: a * 2 };
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  a = -a;
  Object.assign(o3, o1);
  a = -a;
  if (o1.x > o2.x) {
    box.inner.y += a;
    out += show(o1) + " ";
  } else {
    {
      const fresh: Flat = make(given[4], given[1]);
      box.list = [a + 1, -0];
      out += num({ x: fresh.x, y: o1.y }.x) + " ";
    }
  }
  try {
    out += Object.keys(o1).join() + " ";
    fail(o1 === o3);
    {
      const [l, r] = both(o1.x);
      l.x += r.y;
      out += num(l.x) + "," + num(r.x) + "," + (l === r) + " ";
    }
  } catch {
    o1.x = soft[a & 1];
    b += 0.5;
  }
  for (let i = 0; i < 4 && turns++ < 8; i++) {
    out += num({ x: o2.x, y: o1.y }.x) + " ";
  }
  out +=
    show(o1) +
    show(o2) +
    show(o3) +
    " " +
    num(box.inner.x) +
    "," +
    num(box.inner.y) +
    box.tag +
    box.list.join("/") +
    num(box.total()) +
    local.length +
    (o1 === o2) +
    (o2 === o3);
  return out;
}
class Holder5 {
  inner = { x: 1, y: 2 };
  tag = "t";
  list: number[] = [0.5, 1];
  constructor(x: number) {
    this.inner = { x: x + 1, y: 3 };
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
async function run3(p: number, q: number): Promise<string> {
  let out = "";
  let a: number = p;
  let b: number = p * 2;
  let turns = 0;
  let o1: Flat = both(b)[1];
  let o2: Flat = new Point(o1.x, q).moved(a + b);
  const box = new Holder5(o2.y);
  let o3: Flat = (() => o1)();
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  for (let i = 0; i < 4 && turns++ < 8; i++) {
    if (a === 12345) kept.push(o2);
  }
  switch (a & 3) {
    case 0:
      {
        let head: Link | null = null;
        for (let i = 0; i < 3; i++) head = { v: a | (0 + i), next: head };
        let n = 0;
        for (let c = head; c; c = c.next) n = n * 10 + c.v;
        out += num(n) + " ";
      }
      break;
    case 1:
      [o2.x, o2.y] = [o2.y, o2.x];
    default:
      out += num((o3 === o3 ? o3 : o3).y) + " ";
  }
  try {
    grow(o3);
    fail(o3.y !== o3.y);
    {
      let head: Link | null = null;
      for (let i = 0; i < 3; i++) head = { v: o1.y + i, next: head };
      let n = 0;
      for (let c = head; c; c = c.next) n = n * 10 + c.v;
      out += num(n) + " ";
    }
  } catch {
    {
      const fresh: Flat = new Point(7, a + b);
      fresh.x = o2.y;
      for (const key in fresh) out += key;
      out += " ";
    }
  }
  out +=
    show(o1) +
    show(o2) +
    show(o3) +
    " " +
    num(box.inner.x) +
    "," +
    num(box.inner.y) +
    box.tag +
    box.list.join("/") +
    num(box.total()) +
    local.length +
    (o1 === o2) +
    (o2 === o3);
  return out;
}
async function run4(p: number, q: number): Promise<string> {
  let out = "";
  let a: number = p;
  let b: number = 1;
  let turns = 0;
  const o1: Flat = new Point(a, p);
  const o2: Flat = make(a, given[1]);
  const box: Nest = nest(a | 0);
  const o3: Flat = (() => o1)();
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  out += show(o1) + " ";
  out += (o2 instanceof Point ? num(o2.sum()) : "plain") + " ";
  switch (a & 3) {
    case 0:
      a = -a;
      break;
    case 1:
      out += num(turned(o2).x) + "," + num(turned(turned(o2)).x) + " ";
    default:
      b = a;
  }
  if (o2.y !== o2.y) {
    box.list = [given[4], box.inner.x];
  } else {
    {
      const [l, r] = both(a + b);
      l.x += r.y;
      out += num(l.x) + "," + num(r.x) + "," + (l === r) + " ";
    }
  }
  if (given[0] < 1) {
    out += (o1 instanceof Point) + "," + (o1 instanceof Point3) + " ";
    out += (o1 instanceof Point) + "," + (o1 instanceof Point3) + " ";
  } else {
    out += Object.keys(o3).join() + " ";
  }
  await null;
  if (o3.x === 0.5) kept.push([o1, o2]);
  out += (o2 instanceof Point) + "," + (o2 instanceof Point3) + " ";
  out +=
    num(o1.x) +
    "," +
    num(o1.y) +
    "," +
    num(o2.x) +
    "," +
    num(o2.y) +
    "," +
    num(o3.x) +
    "," +
    num(o3.y) +
    " " +
    show(box) +
    local.length +
    (o1 === o2) +
    (o2 === o3);
  return out;
}
class Holder7 {
  inner = { x: 0.5, y: 2 };
  tag = "t";
  list: number[] = [1];
  constructor(x: number) {
    this.inner = { x: x + 1, y: 3 };
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run5(p: number, q: number): string {
  let out = "";
  function* steps(): Generator<string, void, unknown> {
    let a: number = p;
    let b: number = 0.5;
    let turns = 0;
    let o1: Flat = Point.of(a / 2, a);
    let o2: Flat = { x: a, y: b };
    const box = new Holder7(o1.x);
    let o3: Flat = { x: p, y: a * 2 };
    const local: Flat[] = [];
    const many: number[] = [a, b, 1];
    const soft = many as any;
    switch (a & 3) {
      case 0:
        yield "|";
        break;
      case 1:
        o1.y = o1.x;
      default:
        if (p > q) kept.push(box);
    }
    if (given[0] > 0) {
      out += num(Math.max(o2.x, o1.x)) + "," + num(o2.x * o1.y) + " ";
    } else {
      yield "|";
      [o3.x, o3.y] = [o3.y, o3.x];
    }
    out +=
      num(o1.x) +
      "," +
      num(o1.y) +
      "," +
      num(o2.x) +
      "," +
      num(o2.y) +
      "," +
      num(o3.x) +
      "," +
      num(o3.y) +
      " " +
      show(box) +
      num(box.total()) +
      local.length +
      (o1 === o2) +
      (o2 === o3);
  }
  let seen = "";
  for (const step of steps()) {
    seen += step;
    if (seen.length > 3) break;
  }
  return seen + out;
}
class Holder8 {
  inner = { x: 1, y: 2 };
  tag = "t";
  list: number[] = [0.5, 1];
  constructor(x: number) {
    this.inner = { x, y: x };
    this.inner.y += 1;
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run6(p: number, q: number): string {
  let out = "";
  function* steps(): Generator<string, void, unknown> {
    let a: number = p;
    let b: number = q;
    let turns = 0;
    let o1: Flat = Object.assign({ x: 0, y: 0 }, { x: a / 2 });
    let o2: Flat = new Point(o1.x + o1.y, a + b);
    const box = new Holder8(given[1]);
    let o3: Flat = box.inner;
    const local: Flat[] = [];
    const many: number[] = [a, b, 1];
    const soft = many as any;
    try {
      {
        const fresh: Flat = { x: b, y: 0.5 };
        box.inner = { x: a * 2, y: a };
        out += Object.values(fresh).join() + " ";
      }
      fail(o2.x > o1.x);
      a *= 2;
    } catch {
      o2 = { x: o2.y, y: o2.x };
      o2 = turned(o2);
    }
    for (let i = 0; i < 3 && turns++ < 8; i++) {
      const next: Flat = new Point(o3.y, o3.x + 1);

      o1 = next;
    }
    if (box.list.length > 1) {
      out += String(soft[a & 3]) + num(o1.y) + " ";
    } else {
      b += 0.5;
      o3.x = o2.x + o3.y;
    }
    {
      const answer = (() => {
        try {
          o1 = box.inner;
          return turned(o1);
        } catch {}
      })();
      out += show(answer) + num(o2.y) + " ";
    }
    [o3.x, o3.y] = [o3.y, o3.x];
    o3 = o3;
    out +=
      num(o1.x) +
      "," +
      num(o1.y) +
      "," +
      num(o2.x) +
      "," +
      num(o2.y) +
      "," +
      num(o3.x) +
      "," +
      num(o3.y) +
      " " +
      show(box) +
      num(box.total()) +
      local.length +
      (o1 === o2) +
      (o2 === o3);
  }
  return [...steps()].join("") + out;
}
class Holder9 {
  inner: Flat;
  tag = "t";
  list: number[] = [];
  constructor(x: number) {
    this.inner = { x, y: x };
    this.inner.y += 1;
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run7(p: number, q: number): string {
  let out = "";
  function* steps(): Generator<string, void, unknown> {
    let a: number = p + 1;
    let b: number = p * 2;
    let turns = 0;
    const o1: Flat = { x: a, y: 7 };
    const o2: Flat = { x: a, y: a };
    const box = new Holder9(a * 2);
    const o3: Flat = made1(0, -0);
    const local: Flat[] = [];
    const many: number[] = [a, b, 1];
    const soft = many as any;
    for (let i = 0; i < 4 && turns++ < 8; i++) {
      yield "|";
      a *= 2;
      Object.assign(o1, o1);
    }
    try {
      grow(pick(o2, o3, p === 3));
      fail(o2.y !== o2.y);
      {
        const [l, r] = both(given[4]);
        l.x += r.y;
        out += num(l.x) + "," + num(r.x) + "," + (l === r) + " ";
      }
    } catch {
      if (given[0] < 1) kept.push(o1);
      kept.push([o1, o2]);
    }
    for (let i = 0; i < 2 && turns++ < 8; i++) {
      o1.x = o2.x + o1.y;
    }
    box.inner.x = soft[2];
    out +=
      show(o1) + show(o2) + show(o3) + " " + show(box) + num(box.total()) + local.length + (o1 === o2) + (o2 === o3);
  }
  return [...steps()].join("") + out;
}
class Holder10 {
  inner: Flat;
  tag = "t";
  list: number[] = [1];
  constructor(x: number) {
    this.inner = { x: x + 1, y: 3 };
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run8(p: number, q: number): string {
  let out = "";
  let a: number = 1;
  let b: number = p * 2;
  let turns = 0;
  const o1: Flat = [{ x: b, y: a * 65536 }][0];
  const o2: Flat = o1;
  const box = new Holder10(a);
  const o3: Flat = new Point(o2.x, a + 1).moved(a - b);
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  out += num(sumOf(o2)) + " ";
  out += num(turned(o1).x) + "," + num(turned(turned(o1)).x) + " ";
  out += num([o1, o2][a & 1].x) + " ";
  {
    const answer = (() => {
      try {
        return (1.5).toFixed(loose[a]);
      } catch {}
    })();
    out += show(answer) + num(o1.y) + " ";
  }
  for (let i = 0; i < 3 && turns++ < 8; i++) {
    box.inner.y += a + b;
    box.tag += "g";
    if (given[0] < 1) kept.push({ ...o2 });
  }
  for (let i = 0; i < 3 && turns++ < 8; i++) {
    box.tag += "g";
    out += num(turned(o1).x) + "," + num(turned(turned(o1)).x) + " ";
  }
  out += num({ x: o2.x, y: o2.y }.x) + " ";
  out += num(o2.x) + "," + num(o2.y) + " ";
  box.inner.x = a * 2;
  out += (1.5).toFixed(loose[1] & 3) + num(o2.x) + " ";
  out +=
    show(o1) +
    show(o2) +
    show(o3) +
    " " +
    num(box.inner.x) +
    "," +
    num(box.inner.y) +
    box.tag +
    box.list.join("/") +
    num(box.total()) +
    local.length +
    (o1 === o2) +
    (o2 === o3);
  return out;
}
class Holder11 {
  inner: Flat = new Point(1, 2);
  tag = "t";
  list: number[] = [0.5, 1];
  constructor(x: number) {
    this.inner = { x, y: x };
    this.inner.y += 1;
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run9(p: number, q: number): string {
  let out = "";
  let a: number = 1;
  let b: number = q;
  let turns = 0;
  let o1: Flat = made1(a, a * 2);
  let o2: Flat = Point.of(a, q);
  const box = new Holder11(a);
  let o3: Flat = Point.of(o2.x, o2.y);
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  for (let i = 0; i < 3 && turns++ < 8; i++) {
    const next: Flat = new Point(o3.y, o3.x + 1);

    o2 = next;
  }
  {
    const answer = (() => {
      try {
        return (1.5).toFixed(loose[a & 3]);
      } catch {}
    })();
    out += show(answer) + num(o3.y) + " ";
  }
  if (given[0] < 1) {
    [o2.x, o2.y] = [o2.y, o2.x];
  } else {
    out += JSON.stringify(o3) + " ";
    box.list.push(soft[0]);
  }
  a *= 2;
  out += num(o2.x) + "," + num(o2.y) + " ";
  out +=
    num(o1.x) +
    "," +
    num(o1.y) +
    "," +
    num(o2.x) +
    "," +
    num(o2.y) +
    "," +
    num(o3.x) +
    "," +
    num(o3.y) +
    " " +
    show(box) +
    num(box.total()) +
    local.length +
    (o1 === o2) +
    (o2 === o3);
  return out;
}
for (let round = 0; round < 2; round++) console.log("1: " + run1(0.5, 2));
for (let round = 0; round < 2; round++) console.log("2: " + run2(-1, 4));
for (let round = 0; round < 3; round++) console.log("3: " + (await run3(round + 3, round)));
console.log("4: " + (await run4(2147483640, 3)));
for (let round = 0; round < 3; round++) console.log("5: " + run5(0.5, 2));
for (let round = 0; round < 2; round++) console.log("6: " + run6(round, 2));
console.log("7: " + run7(3, 60));
console.log("8: " + run8(1, 2));
for (let round = 0; round < 2; round++) console.log("9: " + run9(round, 2));
console.log(kept.map(each => (typeof each === "function" ? "f" + each() : show(each))).join(" "), show(last));
