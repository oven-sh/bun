// A test of a tag says which member of a union an object is, as long as the tag holds what the member was created with. Every way to give an object the tag of another member has to read what plain Bun reads.
type Round = { kind: 1; r: number };
type Wide = { kind: 2; w: number };
type High = { kind: 3; h: number };
type Shape = Round | Wide | High;

function area(s: Shape): number {
  switch (s.kind) {
    case 1:
      return s.r * 3;
    case 2:
      return s.w * 2;
    default:
      return s.h;
  }
}

function makeShape(i: number): Shape {
  const k = i % 3;
  if (k === 0) return { kind: 1, r: i };
  if (k === 1) return { kind: 2, w: i };
  return { kind: 3, h: i };
}

let total = 0;
for (let i = 0; i < 300; i++) total += area(makeShape(i));
console.log("one number a member", total);

type Oval = { kind: 1 | 4; r: number };
type Box = { kind: 2; w: number };
type Bar = { kind: 3; h: number };
type Figure = Oval | Box | Bar;

function size(f: Figure): number {
  switch (f.kind) {
    case 1:
    case 4:
      return f.r * 3;
    case 2:
      return f.w * 2;
    default:
      return f.h;
  }
}

function makeFigure(i: number): Figure {
  const k = i & 3;
  if (k === 0) return { kind: 1, r: i };
  if (k === 1) return { kind: 4, r: i };
  if (k === 2) return { kind: 2, w: i };
  return { kind: 3, h: i };
}

total = 0;
for (let i = 0; i < 300; i++) total += size(makeFigure(i));
console.log("two numbers in one member", total);

type Value = { tag: "value"; ok: true; value: number };
type Failure = { tag: "failure"; ok: false; error: string };
type Result = Value | Failure;

function makeResult(i: number): Result {
  return i % 4 ? { tag: "value", ok: true, value: i } : { tag: "failure", ok: false, error: "e" + i };
}
function byString(r: Result): number | string {
  if (r.tag === "value") return r.value;
  return r.error;
}
function byOtherString(r: Result): number | string {
  if (r.tag !== "failure") return r.value;
  else return r.error;
}
function byBoolean(r: Result): number | string {
  return r.ok ? r.value : r.error;
}
function byNegation(r: Result): number | string {
  if (!r.ok) return r.error;
  return r.value;
}

const seen: (number | string)[] = [];
for (let i = 0; i < 6; i++) {
  const r = makeResult(i);
  seen.push(byString(r), byOtherString(r), byBoolean(r), byNegation(r));
}
console.log("strings and booleans", seen.join());

const retagged = makeShape(0);
(retagged as any).kind = 2;
console.log("the tag of another member", area(retagged), Object.keys(retagged).join());

const outside = makeShape(1);
(outside as any).kind = 9;
console.log("a tag of no member", area(outside));

const untagged = makeShape(3);
delete (untagged as any).kind;
console.log("no tag", area(untagged), Object.keys(untagged).join());

const computed = makeShape(6);
let reads = 0;
Object.defineProperty(computed, "kind", {
  get() {
    reads++;
    return 2;
  },
});
console.log("a tag that a getter answers", area(computed), reads);

function tagReadFirst(s: Shape): number {
  const kind = s.kind;
  (s as any).kind = 2;
  return kind === 1 ? (s as Round).r : -1;
}
console.log("a store between the read and the test", tagReadFirst(makeShape(9)), tagReadFirst(makeShape(10)));

function tagOfAnother(s: Shape, t: Shape): number | undefined {
  return t.kind === 1 ? (s as Round).r : (s as Wide).w;
}
console.log("the tag of another object", tagOfAnother(makeShape(1), makeShape(0)), tagOfAnother(makeShape(0), makeShape(1)), tagOfAnother(makeShape(0), makeShape(0)));

function tagAgainstVariable(s: Shape, kind: number): number | undefined {
  return s.kind === kind ? (s as Round).r : (s as High).h;
}
console.log("a tag compared with a variable", tagAgainstVariable(makeShape(0), 1), tagAgainstVariable(makeShape(0), 2), tagAgainstVariable(makeShape(2), 1), tagAgainstVariable(makeShape(1), 2));

type Zero = { kind: 0; z: number };
type Minus = { kind: number; m: number };
function zeroes(v: Zero | Minus): number | undefined {
  switch (v.kind) {
    case 0:
      return (v as Zero).z;
    default:
      return (v as Minus).m;
  }
}
const zero: Zero = { kind: 0, z: 1 };
const minusZero: Minus = { kind: -0, m: 2 };
const notANumber: Minus = { kind: NaN, m: 3 };
console.log("zero, minus zero and NaN", zeroes(zero), zeroes(minusZero), zeroes(notANumber));

class Leaf {
  kind = 1 as const;
  text = "leaf";
}
class Pair {
  kind = 2 as const;
  left: Tree;
  right: Tree;
  constructor(left: Tree, right: Tree) {
    this.left = left;
    this.right = right;
  }
}
type Tree = Leaf | Pair;
function count(t: Tree): number {
  return t.kind === 1 ? t.text.length : count(t.left) + count(t.right);
}
let tree: Tree = new Leaf();
for (let i = 0; i < 5; i++) tree = new Pair(tree, new Leaf());
console.log("classes", count(tree));

function walk(first: Shape, shapes: Shape[]): number {
  let sum = 0;
  let current = first;
  for (let i = 0; i < shapes.length; i++) {
    if (current.kind === 1) {
      current = shapes[i]!;
      sum += (current as Round).r || 0;
    } else {
      sum += area(current);
      current = shapes[i]!;
    }
  }
  return sum;
}
console.log("another object each turn", walk(makeShape(0), [makeShape(1), makeShape(0), makeShape(3), makeShape(2), makeShape(6)]));
