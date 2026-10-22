// Small objects that cross one call or one merge and die. Their fields are declared as numbers, strings and booleans, and now and then they are given something else.
// Whatever the compiler does with the objects, each line is what plain JavaScript prints.
const lines: string[] = [];
function show(...parts: unknown[]) {
  lines.push(parts.map(part => (Object.is(part, -0) ? "-0" : typeof part === "string" ? JSON.stringify(part) : String(part))).join(" "));
}

const odd: any[] = [1.5, NaN, -0, 2 ** 31, -(2 ** 31) - 1, 2 ** 53, "text", "", undefined, null, true, false, 7n, Symbol.for("s"), { valueOf: () => 9 }, [3], () => 4, Infinity];
function pick(i: number): any {
  return i % 5 === 3 ? odd[(i >> 2) % odd.length] : i;
}
function text(value: unknown): string {
  return typeof value === "symbol" ? value.toString() : typeof value === "bigint" ? value + "n" : typeof value === "function" ? "function" : Object.is(value, -0) ? "-0" : String(value);
}

interface Step { value: number; done: boolean }
class Counter {
  i = 0;
  constructor(public limit: number) {}
  next(): Step {
    if (this.i < this.limit) return { value: pick(this.i++), done: false };
    return { value: 0, done: true };
  }
}
function walkByHand() {
  const c = new Counter(48);
  let seen = "";
  for (;;) {
    const step = c.next();
    if (step.done) break;
    seen += text(step.value) + ",";
  }
  show("by hand", seen);
}

class Drifting {
  i: number = 0;
  next(): Step {
    const value = this.i;
    this.i = pick(value + 1) === value + 1 ? value + 1 : ((value + 1.5) as number);
    return { value, done: value > 40 };
  }
}
function counterLeavesItsType() {
  const d = new Drifting();
  let seen = "";
  for (let step = d.next(); !step.done; step = d.next()) seen += step.value + ",";
  show("drifting", seen, d.i);
}

interface Span { pos: number; end: number; label: string }
function span(i: number): Span {
  return { pos: pick(i), end: pick(i + 1), label: pick(i + 2) };
}
function readInEveryWay() {
  let all = "";
  for (let i = 0; i < 40; i++) {
    const s = span(i);
    const { pos, end } = s;
    all += text(pos) + "|" + text(end) + "|" + text(s.label) + "|" + text(s["pos"]) + "|" + ("pos" in s) + "|" + Object.hasOwn(s, "label") + ";";
  }
  show("reads", all);
}
function keysKeepTheirOrder() {
  let all = "";
  for (let i = 0; i < 24; i++) {
    const s = span(i);
    let values = "";
    for (const key in s) values += key + "=" + text(s[key as keyof Span]) + ",";
    all += Object.keys(s).join("") + ":" + values + Object.values(s).map(text).join("/") + ";";
  }
  show("keys", all);
}
function storedAgain() {
  let all = "";
  for (let i = 0; i < 40; i++) {
    const s = span(i);
    s.pos = 1;
    const first = s.pos;
    s.pos = pick(i + 3);
    const second = s.pos;
    s.end = s.pos;
    s.pos = 2;
    all += text(first) + text(second) + text(s.end) + text(s.pos) + ";";
  }
  show("stored again", all);
}

const kept: Span[] = [];
function builtOnTheRarePath() {
  for (let i = 0; i < 60; i++) {
    const s = span(i);
    if (i % 17 === 3 || typeof s.end !== "number") kept.push(s);
  }
  show("kept", kept.length, kept.map(s => Object.keys(s).join("") + text(s.pos) + "/" + text(s.end) + "/" + text(s.label)).join(";"));
  const first = kept[0];
  first.pos = 5;
  show("kept, stored", first.pos, kept[0] === first, kept[0] === kept[1]);
}

function oneOfTwo(i: number): Span | undefined {
  if (i % 7 === 0) return undefined;
  if (i % 2) return { pos: i, end: i + 1, label: "odd" };
  return { pos: pick(i), end: pick(i), label: "even" };
}
function merged() {
  let all = "";
  for (let i = 0; i < 40; i++) {
    const s = oneOfTwo(i);
    all += s ? text(s.pos) + s.label + text(s.end) : "none";
    const t = i % 3 ? s : span(i);
    all += t ? text(t.pos) + text(t.label) : "-";
    all += s === t ? "same;" : "other;";
  }
  show("merged", all);
}

function pair(i: number): [number, string] {
  return [pick(i), pick(i + 1)];
}
function tuples() {
  let all = "";
  for (let i = 0; i < 40; i++) {
    const [a, b] = pair(i);
    const p = pair(i + 1);
    all += text(a) + text(b) + p.length + text(p[0]) + text(p[1]) + ";";
  }
  show("tuples", all);
}

interface Options { width?: number; pad?: string; left?: boolean }
function withDefaults(options: Options): Required<Options> {
  return { width: options.width ?? 8, pad: options.pad ?? " ", left: options.left ?? false };
}
function configs() {
  let all = "";
  for (let i = 0; i < 40; i++) {
    const o = withDefaults({ width: pick(i), left: pick(i + 1) });
    all += text(o.width) + text(o.pad) + text(o.left) + ";";
  }
  show("configs", all);
}

function deep(depth: number, at: number): Span {
  if (depth === 0) return { pos: pick(at), end: at + 1, label: "leaf" };
  const left = deep(depth - 1, at);
  const right = deep(depth - 1, left.end);
  return { pos: left.pos, end: right.end, label: left.label + text(right.pos) };
}
function recursion() {
  let all = "";
  for (let i = 0; i < 12; i++) {
    const s = deep(3, i);
    all += text(s.pos) + ":" + s.end + ":" + s.label + ";";
  }
  show("recursion", all);
}

function arithmetic() {
  let sum = 0;
  let glued = "";
  for (let i = 0; i < 60; i++) {
    const s = span(i);
    if (typeof s.pos === "number" && typeof s.end === "number") sum += s.end - s.pos;
    else if (typeof s.pos !== "symbol" && typeof s.pos !== "bigint") glued += (s.pos as any) + 1;
  }
  show("arithmetic", sum, glued);
}

walkByHand();
counterLeavesItsType();
readInEveryWay();
keysKeepTheirOrder();
storedAgain();
builtOnTheRarePath();
merged();
tuples();
configs();
recursion();
arithmetic();
console.log(lines.join("\n"));
