// A way that goes past a join, past the end of a block behind a call, or through a join by itself comes to the answer of the way through it.
const names = ["get", "put", "post", "head", "other"];
function kindOf(n: number) {
  if (n < 0) return "put";
  if (n > 9) return "post";
  return names[n % names.length];
}
// A return of the callee decides the first comparison and goes on to the second by itself.
function chainBehindCall(n: number) {
  const k = kindOf(n);
  if (k === "get") return 1 + k.length;
  else if (k === "put") return 20 + k.length;
  else if (k === "post") return 300 + k.length;
  else if (k === "head") return 4000 + k.length;
  return k.length;
}
function chainOfField(node: { kind: number; size: number }) {
  if (node.kind === 1) return node.size;
  else if (node.kind === 2) return node.size * 2;
  else if (node.kind === 3) return node.size * 3;
  else if (node.kind === 1) return -1;
  return node.kind;
}
function chainThenSwitch(t: unknown) {
  if (t === "a") return 1;
  if (t === "b") return 2;
  switch (t) {
    case "c":
      return 3;
    case "a":
      return -1;
    case "d":
      return 4;
  }
  return t === "e" ? 5 : 0;
}

// Every way into the switch knows its case. One case leads on to two others, having written on one of the ways.
function fallsThrough(a: boolean, b: boolean, o: { n: number }) {
  const kind = a ? "a" : b ? "b" : "none";
  let seen = o.n;
  switch (kind) {
    case "a":
      if (o.n > 1) {
        o.n = 0;
        break;
      }
      seen += 10;
    case "b":
      seen += o.n;
      break;
  }
  return seen * 100 + o.n;
}
function someWaysKnow(a: number, text: string) {
  const kind = a === 0 ? "wide" : a === 1 ? "narrow" : text;
  let out = kind.length;
  switch (kind) {
    case "wide":
      out += 10;
      break;
    case "narrow":
      out += 20;
      break;
    default:
      out += 30;
  }
  return out + kind;
}
function numberOfCase(a: boolean, b: boolean) {
  const n: number = a ? 1 : b ? 2 : 7;
  switch (n) {
    case 1:
      return "one";
    case 2:
      return "two";
    case 3:
      return "three";
  }
  return "many";
}

function takenAlong(a: boolean, x: number, y: number) {
  const ok = a ? x < 1 : y < 2;
  if (ok) return "hit";
  return "miss";
}
function takenAlongOutOfTry(a: boolean, o: { v: number } | null) {
  let ok;
  const made = { step: 1 };
  try {
    ok = a ? o!.v > 1 : o!.v < -1;
    made.step = 2;
  } catch {
    ok = made.step === 1;
  }
  if (!ok) return made.step;
  return made.step + 10;
}
function takenAlongOutOfTurns(list: number[], limit: number) {
  let found = false;
  let last = 0;
  for (const i of [0, 1, 2]) {
    last = list[i] * 2;
    if (last > limit) {
      found = last > 2 * limit;
      break;
    }
  }
  if (found) return last;
  return -last;
}

class Circle {
  constructor(public r: number) {}
  area() {
    return 3 * this.r * this.r;
  }
}
class Square {
  constructor(public r: number) {}
  area() {
    return this.r * this.r;
  }
}
class Line {
  constructor(public r: number) {}
  area() {
    return 0;
  }
}
function areaOf(kind: number, wide: boolean, r: number) {
  const s = kind === 0 ? new Circle(r) : kind === 1 ? new Square(r) : new Line(r);
  const k = wide ? 2 : 3;
  return s.area() * k;
}
function storedThenRead(round: boolean, r: number) {
  const s = round ? new Circle(r) : new Square(r);
  s.r = r + 1;
  const before = s.area();
  s.r += before;
  return before + s.area() + s.r;
}
function sumOfAreas(n: number) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const s = i % 3 === 0 ? new Circle(i) : i % 3 === 1 ? new Square(i) : new Line(i);
    total += s.area() + s.r;
  }
  return total;
}

// One field in two places.
class Named {
  name = "a";
  count = 0;
}
class Counted {
  count = 0.5;
  extra = 1;
  name = "b";
}
function setCount(s: Named | Counted, v: number) {
  s.count = v;
  return s.count;
}
function readCount(s: Named | Counted) {
  return s.count;
}

for (let n = -1; n < 12; n++) console.log(n, chainBehindCall(n));
for (let kind = 0; kind < 5; kind++) console.log(kind, chainOfField({ kind, size: 7 }));
for (const t of ["a", "b", "c", "d", "e", "f", 1, null, undefined]) console.log(String(t), chainThenSwitch(t));
for (const a of [true, false]) {
  for (const b of [true, false]) {
    for (const n of [0, 1, 2, 3]) console.log(a, b, n, fallsThrough(a, b, { n }));
    console.log(a, b, numberOfCase(a, b), takenAlong(a, b ? 0 : 1, b ? 1 : 2));
    console.log(takenAlongOutOfTry(a, b ? { v: 2 } : null), takenAlongOutOfTry(a, { v: b ? -2 : 0 }));
  }
}
for (const a of [0, 1, 2]) for (const text of ["wide", "narrow", "other"]) console.log(a, text, someWaysKnow(a, text));
for (const limit of [-1, 1, 3, 5, 9]) console.log(limit, takenAlongOutOfTurns([1, 2, 4], limit));
for (const kind of [0, 1, 2]) console.log(kind, areaOf(kind, true, 2), areaOf(kind, false, 3), storedThenRead(kind === 0, kind + 1));
console.log(sumOfAreas(0), sumOfAreas(1), sumOfAreas(7));

const emptied = new Named();
delete (emptied as { count?: number }).count;
const misfit = new Counted();
(misfit as { count: unknown }).count = "text";
for (const s of [new Named(), new Counted(), emptied, misfit]) {
  console.log(String(readCount(s)), setCount(s, 1.5), setCount(s, 2), readCount(s), Object.keys(s).join());
}
