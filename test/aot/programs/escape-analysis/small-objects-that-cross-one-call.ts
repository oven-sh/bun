// Each row makes small objects that only cross one call. N rounds a row; the counts file says which places still allocate.
const N = 100000;

interface Point { x: number; y: number }
interface Range { start: number; end: number; text: string }

function minMax(a: number, b: number, c: number): { min: number; max: number } {
  let min = a, max = a;
  if (b < min) min = b;
  if (b > max) max = b;
  if (c < min) min = c;
  if (c > max) max = c;
  return { min, max };
}
function rowObjectResult(): number {
  let r = 0;
  for (let i = 0; i < N; i++) {
    const { min, max } = minMax(i, i ^ 5, i >> 1);
    r = (r + max - min) | 0;
  }
  return r;
}

function pair(a: number, b: number): [number, number] {
  if (a > b) return [b, a];
  return [a, b];
}
function rowTupleResult(): number {
  let r = 0;
  for (let i = 0; i < N; i++) {
    const [x, y] = pair(i & 7, i & 3);
    r = (r + x * 3 + y) | 0;
  }
  return r;
}

function maybeRange(text: string, from: number): Range | undefined {
  const start = text.indexOf("a", from);
  if (start < 0) return undefined;
  let end = start;
  while (end < text.length && text.charCodeAt(end) === 97) end++;
  return { start, end, text };
}
function rowObjectOrUndefined(): number {
  let r = 0;
  const text = "xxaaaxxaxxxxaaaaax";
  for (let i = 0; i < N; i++) {
    const found = maybeRange(text, i % 20);
    if (found) r = (r + found.end - found.start) | 0;
  }
  return r;
}

class Counter {
  i = 0;
  constructor(public limit: number) {}
  next(): { value: number; done: boolean } {
    if (this.i < this.limit) return { value: this.i++, done: false };
    return { value: 0, done: true };
  }
}
function rowIteratorResultByHand(): number {
  let r = 0;
  const c = new Counter(N);
  for (;;) {
    const step = c.next();
    if (step.done) break;
    r = (r + step.value) | 0;
  }
  return r;
}

class Numbers implements Iterable<number> {
  constructor(public limit: number) {}
  [Symbol.iterator](): Iterator<number> {
    let i = 0;
    const limit = this.limit;
    return {
      next(): IteratorResult<number> {
        if (i < limit) return { value: i++, done: false };
        return { value: undefined, done: true };
      },
    };
  }
}
function rowForOfOverOwnIterator(): number {
  let r = 0;
  for (const v of new Numbers(N)) r = (r + v) | 0;
  return r;
}

function distance(p: Point, q: Point): number {
  const dx = p.x - q.x, dy = p.y - q.y;
  return dx * dx + dy * dy;
}
function rowObjectArguments(): number {
  let r = 0;
  for (let i = 0; i < N; i++) r = (r + distance({ x: i, y: 1 }, { x: 2, y: i & 15 })) | 0;
  return r;
}

interface Options { width?: number; pad?: string; left?: boolean }
function padTo(text: string, options: Options): number {
  const width = options.width ?? 8;
  const pad = options.pad ?? " ";
  let n = text.length;
  while (n < width) n += pad.length;
  return options.left ? -n : n;
}
function rowOptionsArgument(): number {
  let r = 0;
  for (let i = 0; i < N; i++) r = (r + padTo("abc", { width: i & 15, left: (i & 1) === 0 })) | 0;
  return r;
}

function withDefaults(options: Options): { width: number; pad: string; left: boolean } {
  return { width: options.width ?? 8, pad: options.pad ?? " ", left: options.left ?? false };
}
function rowConfigReturnedByHelper(): number {
  let r = 0;
  for (let i = 0; i < N; i++) {
    const o = withDefaults({ width: i & 7 });
    r = (r + o.width + o.pad.length + (o.left ? 1 : 0)) | 0;
  }
  return r;
}

function add(p: Point, q: Point): Point { return { x: p.x + q.x, y: p.y + q.y }; }
function scale(p: Point, k: number): Point { return { x: p.x * k, y: p.y * k }; }
function rowPointsThroughHelpers(): number {
  let r = 0;
  for (let i = 0; i < N; i++) {
    const p = scale(add({ x: i, y: 1 }, { x: 1, y: i }), 2);
    r = (r + p.x - p.y) | 0;
  }
  return r;
}

function rowObjectEntries(): number {
  let r = 0;
  const o: Record<string, number> = { a: 1, b: 2, c: 3 };
  for (let i = 0; i < N / 4; i++) {
    for (const [k, v] of Object.entries(o)) r = (r + k.length + v) | 0;
  }
  return r;
}

function rowMapEntries(): number {
  let r = 0;
  const m = new Map<string, number>([["a", 1], ["bb", 2], ["ccc", 3]]);
  for (let i = 0; i < N / 4; i++) {
    for (const [k, v] of m) r = (r + k.length + v) | 0;
  }
  return r;
}

let hookState = 0;
function useCounter(step: number): [number, (by: number) => void] {
  const set = (by: number) => { hookState = (hookState + by * step) | 0; };
  return [hookState, set];
}
function rowTupleOutOfHook(): number {
  let r = 0;
  for (let i = 0; i < N; i++) {
    const [value, set] = useCounter(2);
    set(i & 3);
    r = (r + value) | 0;
  }
  return r;
}

function spanOf(depth: number, at: number): { pos: number; end: number } {
  if (depth === 0) return { pos: at, end: at + 1 };
  const left = spanOf(depth - 1, at);
  const right = spanOf(depth - 1, left.end);
  return { pos: left.pos, end: right.end };
}
function rowRecursiveResult(): number {
  let r = 0;
  for (let i = 0; i < N / 16; i++) {
    const s = spanOf(4, i);
    r = (r + s.end - s.pos) | 0;
  }
  return r;
}

function visit(p: Point, f: (p: Point) => number): number { return f(p) + 1; }
function rowArgumentHandedOnToCallback(): number {
  let r = 0;
  const f = (p: Point) => p.x + p.y;
  for (let i = 0; i < N; i++) r = (r + visit({ x: i, y: 2 }, f)) | 0;
  return r;
}

const shapes: Array<{ area(k: number): { w: number; h: number } }> = [
  { area(k) { return { w: k, h: 2 }; } },
  { area(k) { return { w: 3, h: k }; } },
];
function rowResultOfCallByValue(): number {
  let r = 0;
  for (let i = 0; i < N; i++) {
    const a = shapes[i & 1].area(i & 31);
    r = (r + a.w * a.h) | 0;
  }
  return r;
}

const rows: Array<[string, () => number]> = [
  ["object result", rowObjectResult],
  ["tuple result", rowTupleResult],
  ["object or undefined", rowObjectOrUndefined],
  ["iterator result by hand", rowIteratorResultByHand],
  ["for-of over own iterator", rowForOfOverOwnIterator],
  ["object arguments", rowObjectArguments],
  ["options argument", rowOptionsArgument],
  ["config returned by helper", rowConfigReturnedByHelper],
  ["points through helpers", rowPointsThroughHelpers],
  ["Object.entries", rowObjectEntries],
  ["Map entries", rowMapEntries],
  ["tuple out of hook", rowTupleOutOfHook],
  ["recursive result", rowRecursiveResult],
  ["argument handed on to callback", rowArgumentHandedOnToCallback],
  ["result of call by value", rowResultOfCallByValue],
];
for (const [name, row] of rows) console.log(name, row());
