import { again, baseA, baseC, baseD, fillA, fillC, fillD } from "./nodes.ts";

const which: string = process.argv[2] ?? "";
const rounds: number = Number(process.argv[3] ?? "64");
const start: number = Number(process.argv[4] ?? "1");

const literal: string[] = ["a", "b", "c", "d", "e", "f", "g", "h"];
const built: string[] = [];
for (let i = 0; i < 8; i++) built.push("x" + i);
const more: string[] = [];
for (let i = 0; i < 3; i++) more.push("y" + i);
let kept: string[] = literal;

function makeScannerDeclaredFirst(): () => number {
  let pos = 0, end = 0, token = 0, line = 0, column = 0;
  return function step() {
    pos = (pos + 1) & 1023; end = (end + 2) & 1023; token = (token + 3) & 255; line = (line + 1) & 4095; column = (column + 5) & 127;
    return pos + end + token + line + column;
  };
}
function makeScannerDeclaredLast(early: boolean): () => number {
  const peek = () => pos + end + token + line + column;
  const step = () => {
    pos = (pos + 1) & 1023; end = (end + 2) & 1023; token = (token + 3) & 255; line = (line + 1) & 4095; column = (column + 5) & 127;
    return pos + end + token + line + column;
  };
  if (early) {
    try { peek(); } catch { }
  }
  let pos = 0, end = 0, token = 0, line = 0, column = 0;
  return step;
}

class Root {
  value(x: number): number { return x + 1; }
  static make(x: number): number { return x + 2; }
}
class OtherRoot extends Root {
  value(x: number): number { return x + 3; }
  static make(x: number): number { return x + 4; }
}
const bases: Array<typeof Root> = [Root, OtherRoot];
const Picked: typeof Root = bases[Number(process.argv[5] ?? "0")];
class Leaf extends Picked {
  value(x: number): number { return super.value(x) + 1; }
  static make(x: number): number { return super.make(x) + 1; }
}

// The same three shapes, told apart by a number and by a text that is the name of no property anywhere.
type CircleByNumber = { tag: 1; r: number };
type RingByNumber = { tag: 2; r: number; inner: number };
type SquareByNumber = { tag: 3; side: number };
type ShapeByNumber = CircleByNumber | RingByNumber | SquareByNumber;
type CircleByText = { kind: "a circle"; r: number };
type RingByText = { kind: "a ring"; r: number; inner: number };
type SquareByText = { kind: "a square"; side: number };
type ShapeByText = CircleByText | RingByText | SquareByText;
function areaByNumber(shape: ShapeByNumber): number {
  switch (shape.tag) {
    case 1: return shape.r * shape.r * 3;
    case 2: return (shape.r * shape.r - shape.inner * shape.inner) * 3;
    case 3: return shape.side * shape.side;
  }
}
function areaByText(shape: ShapeByText): number {
  switch (shape.kind) {
    case "a circle": return shape.r * shape.r * 3;
    case "a ring": return (shape.r * shape.r - shape.inner * shape.inner) * 3;
    case "a square": return shape.side * shape.side;
  }
}
const shapesByNumber: ShapeByNumber[] = [], shapesByText: ShapeByText[] = [];
for (let i = 0; i < 64; i++) {
  shapesByNumber.push(i % 3 === 0 ? { tag: 1, r: i } : i % 3 === 1 ? { tag: 2, r: i, inner: 1 } : { tag: 3, side: i });
  shapesByText.push(i % 3 === 0 ? { kind: "a circle", r: i } : i % 3 === 1 ? { kind: "a ring", r: i, inner: 1 } : { kind: "a square", side: i });
}

const loops: Record<string, (n: number) => number> = {
  "switch on a number tag": n => { let sum = 0; for (let i = 0; i < n; i++) sum += areaByNumber(shapesByNumber[i & 63]); return sum; },
  "switch on a text tag": n => { let sum = 0; for (let i = 0; i < n; i++) sum += areaByText(shapesByText[i & 63]); return sum; },
  "index": n => { let sum = 0; for (let i = 0; i < n; i++) sum += built[i & 7].length; return sum; },
  "at": n => { let sum = 0; for (let i = 0; i < n; i++) sum += built.at(i & 7)!.length; return sum; },
  "at of a literal": n => { let sum = 0; for (let i = 0; i < n; i++) sum += literal.at(i & 7)!.length; return sum; },
  "spread": n => { let sum = 0; for (let i = 0; i < n; i++) { kept = [...built, ...more]; sum += i & 1; } return sum + kept.length; },
  "concat": n => { let sum = 0; for (let i = 0; i < n; i++) { kept = built.concat(more); sum += i & 1; } return sum + kept.length; },
  "slice from an integer": n => { let sum = 0; const from = start | 0; for (let i = 0; i < n; i++) { kept = built.slice(from); sum += i & 1; } return sum + kept.length; },
  "slice from a number": n => { let sum = 0; for (let i = 0; i < n; i++) { kept = built.slice(start); sum += i & 1; } return sum + kept.length; },
  "slice between integers": n => { let sum = 0; const from = start | 0; for (let i = 0; i < n; i++) { kept = built.slice(from, from + 4); sum += i & 1; } return sum + kept.length; },
  "slice between numbers": n => { let sum = 0; for (let i = 0; i < n; i++) { kept = built.slice(start, start + 4); sum += i & 1; } return sum + kept.length; },
  "super in a static method": n => { let sum = 0; for (let i = 0; i < n; i++) sum += Leaf.make(i); return sum; },
  "super in an instance method": n => { let sum = 0; const leaf = new Leaf(); for (let i = 0; i < n; i++) sum += leaf.value(i); return sum; },
  "constructor that is only constructed": n => { let sum = 0; for (let i = 0; i < n; i++) sum += baseA((i & 31) + 1, i).end; return sum; },
  "constructor that is also called": n => { let sum = 0; for (let i = 0; i < n; i++) sum += baseC((i & 31) + 1, i).end; return sum; },
  "constructor that native code holds": n => { let sum = 0; for (let i = 0; i < n; i++) sum += baseD((i & 31) + 1, i).end; return sum; },
  "variables declared above the closures": n => { let sum = 0; const step = makeScannerDeclaredFirst(); for (let i = 0; i < n; i++) sum += step(); return sum; },
  "variables declared below the closures": n => { let sum = 0; const step = makeScannerDeclaredLast(n === 3); for (let i = 0; i < n; i++) sum += step(); return sum; },
};

console.log(fillA(), fillC(), fillD(), again(baseC(3, 1)).end);
if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
