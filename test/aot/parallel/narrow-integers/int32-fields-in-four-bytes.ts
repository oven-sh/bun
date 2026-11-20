// A field that holds nothing but int32s takes four bytes and holds every int32, the five lowest ones too.
import type { int32 } from "bun";
const numbers = [-2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, 2147483647, 0, -1, 1];
function at(index: number): int32 {
  return numbers[index % numbers.length]! | 0;
}

class Cursor {
  line: int32 = 0;
  weight = 0;
  parent: Cursor | null = null;
}
function makeCursor(line: int32, weight: number, parent: Cursor | null): Cursor {
  const cursor = new Cursor();
  cursor.line = line;
  cursor.weight = weight;
  cursor.parent = parent;
  return cursor;
}

// The constructor leaves its fields to methods, which create them or store over them.
class Span {
  from: int32;
  to: int32;
  next: Span | null;
  last: Span | null;
  constructor(from: int32, to: int32, next: Span | null) {
    this.from = from;
    this.to = 5;
    this.next = next;
    this.last = null;
    this.move(to);
    this.move(at(from & 7));
    if (this.to < 0) this.to = to;
  }
  move(to: int32): void {
    this.to = to;
  }
  length(): number {
    return this.to - this.from;
  }
}

class Wide extends Span {
  depth: int32;
  mark: Span | null = null;
  other: Span | null = null;
  constructor(from: int32, to: int32, next: Span | null, depth: int32) {
    super(from, to, next);
    this.depth = depth;
  }
}

// Asked for its keys while it is made.
class Early {
  first: int32;
  second: int32;
  next: Early | null;
  seen: string;
  constructor(first: int32, second: int32, next: Early | null) {
    const before = "first" in this;
    this.first = first;
    const between = "second" in this;
    this.second = second;
    this.next = next;
    this.seen = `${before} ${between} ${"second" in this}`;
  }
}

function makePair(a: int32, b: int32, c: string, next: { a: int32; b: int32; c: string; next: any } | null) {
  return { a, b, c, next };
}

let top: Cursor | null = null;
for (let i = 0; i < 30; i++) top = makeCursor(at(i), i / 3, top);
let hash = 0;
for (let cursor: Cursor | null = top; cursor; cursor = cursor.parent) {
  hash = (hash * 31 + cursor.line) | 0;
  if (cursor.line === -2147483647) cursor.line = (cursor.line + 1) | 0;
  else if (cursor.line === -2147483646) cursor.line = (cursor.line - 1) | 0;
  else cursor.line = cursor.line ^ 1;
}
for (let cursor: Cursor | null = top; cursor; cursor = cursor.parent) console.log(cursor.line, cursor.weight.toFixed(2), Object.is(cursor.line, -0));
console.log(hash);

let span: Span | null = null;
for (let i = 0; i < 24; i++) {
  span = i % 5 === 4 ? new Wide(at(i), at(i + 3), span, at(i + 1)) : new Span(at(i), at(i + 2), span);
  if (i % 3 === 0) span.move(at(i + 5));
}
for (let one: Span | null = span; one; one = one.next) console.log(one.from, one.to, one.length(), one instanceof Wide ? one.depth : "");

let early: Early | null = null;
for (let i = 0; i < 12; i++) early = new Early(at(i), at(i + 1), early);
for (let one: Early | null = early; one; one = one.next) console.log(one.first, one.second, one.seen);

let pair: ReturnType<typeof makePair> | null = null;
for (let i = 0; i < 12; i++) pair = makePair(at(i), at(i + 4), "c" + (i & 1), pair);
for (let one: any = pair; one; one = one.next) console.log(one.a, one.b, one.c);
