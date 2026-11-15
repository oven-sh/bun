const xs: number[] = JSON.parse("[" + Array.from({ length: 40 }, (_, k) => (k * 37) % 11).join() + "]");

function sum(step: (x: number) => number): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s = (s + step(xs[i]!)) | 0;
  return s;
}
function make(key: any): (x: number) => number {
  return x => {
    switch (key) {
      case "go": return x + 1;
      case "no": return x * 2;
      case "": return x - 3;
      default: return x;
    }
  };
}
function fallsThrough(key: string): (x: number) => number {
  return x => {
    let y = x;
    switch (key) {
      case "both": y += 10;
      case "one": y += 1; break;
      case "none": break;
      default: y = -y;
    }
    return y;
  };
}
function thrower(key: string): (x: number) => number {
  return x => {
    switch (key) {
      case "bad": if (x === 9) throw new RangeError("nine"); return x;
      default: return x + 100;
    }
  };
}
const rope = (() => { let t = "g"; for (let i = 0; i < 3; i++) t += i === 0 ? "o" : ""; return t + JSON.parse('""'); })();
const long = JSON.parse('"go' + " ".repeat(60) + '"');
const subjects: any[] = [JSON.parse('"go"'), "no", "", "other", rope, long, "go ".trim(), "go", "g\u{1f600}", undefined, null, 0, 1, NaN, true, Symbol("go"), new String("go"), ["go"], { toString() { throw new Error("converted"); } }, () => "go", 10n];
console.log(subjects.map(subject => sum(make(subject))).join(" "));
console.log(["both", "one", "none", "other"].map(key => sum(fallsThrough(key))).join(" "));
for (const key of ["bad", "good"]) {
  try {
    console.log(key, sum(thrower(key)));
  } catch (error) {
    console.log(key, (error as Error).name);
  }
}

function inLoop(key: string, length: number): string {
  let s = 0;
  let text = "";
  for (let i = 0; i < length; i++) {
    switch (key) {
      case "add": s += xs[i % xs.length]!; break;
      case "text": text += String(xs[i % xs.length]!); break;
      case "skip": continue;
      case "stop": if (i === 5) return "stopped at " + i; break;
    }
    s++;
  }
  return s + "," + text;
}
for (const length of [0, 1, 12]) console.log(["add", "text", "skip", "stop", "?"].map(key => inLoop(key, length)).join(" | "));

function changes(): number {
  let key = JSON.parse('"a"');
  let s = 0;
  for (let i = 0; i < 30; i++) {
    switch (key) {
      case "a": s += 1; if (i === 10) key = "b"; break;
      case "b": s += 100; if (i === 20) key = { valueOf: () => "a" }; break;
      default: s += 10000;
    }
  }
  return s;
}
let captured: any = JSON.parse('"a"');
function changedByACall(): number {
  const turn = (i: number) => { if (i % 4 === 3) captured = captured === "a" ? "b" : "a"; };
  let s = 0;
  for (let i = 0; i < 30; i++) {
    switch (captured) {
      case "a": s += 1; break;
      case "b": s += 100; break;
    }
    turn(i);
  }
  return s;
}
const held = { kind: JSON.parse('"a"') };
function changedThroughAField(): number {
  let s = 0;
  for (let i = 0; i < 30; i++) {
    switch (held.kind) {
      case "a": s += 1; break;
      case "b": s += 100; break;
      case "c": s += 10000; break;
    }
    if (i === 11) held.kind = "b";
    if (i === 22) held.kind = "c";
  }
  return s;
}
console.log(changes(), changedByACall(), changedThroughAField());

function nested(outer: string, inner: string): number {
  let s = 0;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      switch (outer) {
        case "row":
          switch (inner) {
            case "odd": s += j & 1 ? i : 0; break;
            case "even": s += j & 1 ? 0 : i; break;
          }
          break;
        case "column": s += j; break;
        default: s--;
      }
    }
  }
  return s;
}
console.log(["row", "column", "none"].flatMap(outer => ["odd", "even", "all"].map(inner => nested(outer, inner))).join(" "));

class Shape {
  constructor(readonly kind: string, readonly size: number) {}
  area(scale: number): number {
    switch (this.kind) {
      case "square": return this.size * this.size * scale;
      case "circle": return (this.size * this.size * 3 * scale) | 0;
      default: return 0;
    }
  }
}
const shape = new Shape(JSON.parse('"circle"'), 4);
let area = 0;
for (let i = 0; i < 20; i++) area += shape.area(i);
console.log(area);
const mode = JSON.parse('"up"');
let moved = 0;
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < xs.length; i++) {
    switch (mode) {
      case "up": moved += xs[i]!; break;
      case "down": moved -= xs[i]!; break;
    }
  }
}
console.log(moved);

function makeFirst(key: any): (x: number) => number { return x => { switch (key) { case "go": return x + 1; case "no": return x * 2; default: return x; } }; }
function makeSecond(key: any): (x: number) => number { return x => { switch (key) { case "a": return x + 10; case "b": return x - 10; case "c": return x * 10; case "": return -x; } return 0; }; }
function makeThird(key: any): (x: number) => number { return x => { let y = x; switch (key) { case "both": y += 10; case "one": y += 1; } return y; }; }
const first = makeFirst(JSON.parse('"no"'));
const second = makeSecond(JSON.parse('""'));
const third = makeThird(JSON.parse('"both"'));
const number = ((key: any) => (x: number) => { switch (key) { case "7": return x + 1; case "": return x + 2; default: return x + 3; } })(JSON.parse("7"));
const object = ((key: any) => (x: number) => { switch (key) { case "go": return x + 1; case "no": return x + 2; default: return x + 3; } })({ toString: () => "go" });
let assigned: any = JSON.parse('"go"');
const free = (x: number) => { switch (assigned) { case "go": if (x === 10) assigned = "no"; return x + 1; case "no": return x * 100; default: return 0; } };
function runFirst(n: number) { let s = 0; for (let r = 0; r < n; r++) for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s = (s + first(x)) | 0; } return s; }
function runSecond(n: number) { let s = 0; for (let r = 0; r < n; r++) for (let i = 0; i < xs.length; i++) s += second(xs[i]!); return s; }
function runThird(n: number) { const out: number[] = []; for (let r = 0; r < n; r++) for (let i = 0; i < xs.length; i++) out[i] = third(xs[i]!); return out.join(); }
function runNumber() { let s = 0; for (let i = 0; i < xs.length; i++) s = (s + number(xs[i]!)) | 0; return s; }
function runObject() { let s = 0; for (let i = 0; i < xs.length; i++) s = (s + object(xs[i]!)) | 0; return s; }
function runFree() { let s = 0; for (let i = 0; i < xs.length; i++) s = (s + free(xs[i]!)) | 0; return s; }
function none() { let s = 0; for (let i = 0; i < 0; i++) s = (s + first(i)) | 0; return s; }
console.log(runFirst(3), runSecond(2), runThird(2), runNumber(), runObject(), runFree(), none());
