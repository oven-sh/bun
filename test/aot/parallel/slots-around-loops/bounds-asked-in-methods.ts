// A bound that another method asks holds for the position that comes round the loop, in every spelling; what the method returns may still be a hole, and a sum that a view takes may hold undefined.
// STATISTIC: CarriedFieldsNarrowedByCopies >= 6
// STATISTIC: ReturnedHolesReadAsNaN >= 4
// STATISTIC: SumsWithUndefinedTruncated >= 2
class Cursor {
  pos = 0;
  constructor(readonly items: number[]) {}
  next(): number { return this.items[this.pos++]; }
  more(): boolean { return this.pos < this.items.length; }
  eof(): boolean { return this.pos >= this.items.length; }
  hasNext(): boolean { return !this.eof(); }
  peek(): number | undefined { return this.items[this.pos]; }
  past(limit: number): boolean { return this.pos > limit; }
  nearlyMore(): boolean { return this.pos <= this.items.length; }
}
class Wide extends Cursor { extra = 1; }

function more(c: Cursor): number { let sum = 0; while (c.more()) sum = (sum + c.next()) | 0; return sum; }
function notEof(c: Cursor): number { let sum = 0; while (!c.eof()) sum = (sum + c.next()) | 0; return sum; }
function hasNext(c: Cursor): number { let sum = 0; while (c.hasNext()) sum = (sum + c.next()) | 0; return sum; }
function present(c: Cursor): number { let sum = 0; while (c.peek() !== undefined) sum = (sum + c.next()) | 0; return sum; }
function left(c: Cursor): number { let sum = 0; for (;;) { if (c.eof()) break; sum = (sum ^ c.next()) | 0; } return sum; }
function nearly(c: Cursor): number { let sum = 0; while (c.nearlyMore()) sum += c.next(); return sum; }
function beyond(c: Cursor): number { let sum = 0; while (!c.past(c.items.length + 2)) sum = (sum + c.next()) | 0; return sum; }
function plain(c: Cursor): number { let sum = 0; while (c.more()) sum += c.next(); return sum; }
function shown(c: Cursor): string { let seen = ""; while (c.more()) seen += c.next() + " "; return seen; }
function asked(c: Cursor): number { let holes = 0; while (c.more()) if (c.next() === undefined) holes++; return holes; }
function twice(c: Cursor): number { let sum = 0; while (c.more()) sum = (sum + c.next() + c.next()) | 0; return sum; }
function moved(c: Cursor): number { let sum = 0; while (c.more()) { sum = (sum + c.next()) | 0; if (sum & 1) c.pos += 0.5; } return sum; }
function back(c: Cursor): number { let sum = 0, steps = 0; while (c.more() && steps++ < 20) { sum = (sum + c.next()) | 0; if (steps === 3) c.pos -= 2; } return sum; }
function shrinks(c: Cursor): number { let sum = 0; while (c.more()) { if (c.pos === 2) c.items.length = 2; sum = (sum + c.next()) | 0; } return sum; }
function grows(c: Cursor): number { let sum = 0; while (c.more()) { if (c.pos === 1 && c.items.length < 12) c.items.push(100); sum = (sum + c.next()) | 0; } return sum; }
function two(c: Cursor, d: Cursor): number { let sum = 0; while (c.more()) { sum = (sum + c.next()) | 0; d.pos += 2; } return sum; }
function nested(c: Cursor): number { let sum = 0; while (c.more()) { let word = 0; while (c.hasNext() && c.next() !== 4) word++; sum = (sum * 3 + word) | 0; } return sum; }

function nans(c: Cursor): number { let found = 0; while (c.more()) found += Object.is(c.next(), NaN) ? 1 : 0; return found; }
function written(c: Cursor): number { let sum = 0; while (c.peek() !== undefined) { c.items[c.pos] = c.pos * 10; sum = (sum + c.next()) | 0; } return sum; }
function cut(c: Cursor): number { let sum = 0; while (c.peek() !== undefined) { if (c.pos === 1) c.items.length = 1; sum = (sum + c.next()) | 0; } return sum; }
function shared(c: Cursor, items: number[]): number { let sum = 0; while (c.peek() !== undefined) { items[c.pos] = 3; sum = (sum + c.next()) | 0; } return sum; }
function turned(c: Cursor): number { let sum = 0; while (c.peek() !== undefined) { if (c.pos === 2) c.items.reverse(); sum = (sum + c.next()) | 0; } return sum; }

function call(name: string, c: Cursor): number | string {
  switch (name) {
    case "more": { return more(c); }
    case "not eof": { return notEof(c); }
    case "has next": { return hasNext(c); }
    case "present": { return present(c); }
    case "left": { return left(c); }
    case "nearly": { return nearly(c); }
    case "beyond": { return beyond(c); }
    case "plain": { return plain(c); }
    case "shown": { return shown(c); }
    case "asked": { return asked(c); }
    case "twice": { return twice(c); }
    case "moved": { return moved(c); }
    case "back": { return back(c); }
    case "shrinks": { return shrinks(c); }
    case "grows": { return grows(c); }
    case "two": { return two(c, c); }
    case "two others": { return two(c, kept[1]); }
    case "nans": { return nans(c); }
    case "written": { return written(c); }
    case "cut": { return cut(c); }
    case "shared": { return shared(c, c.items); }
    case "turned": { return turned(c); }
    case "nested": { return nested(c); }
  }
  return "none";
}
const spellings = ["more", "not eof", "has next", "present", "left", "nearly", "beyond", "plain", "shown", "asked", "twice", "moved", "back", "shrinks", "grows", "two", "two others", "nested", "nans", "written", "cut", "shared", "turned"];
function list(kind: number): number[] {
  switch (kind) {
    case 0: { return [1, 2, 3, 4, 5, 4, 7]; }
    case 1: { return [1.5, 2.25, -0, NaN, 4]; }
    case 2: { const holes = [1, 2, 3, 4, 5]; delete holes[1]; delete holes[3]; return holes; }
    case 3: { const holes = [1.5, 2, 3.5, 4]; delete holes[2]; return holes; }
    case 4: { return []; }
  }
  return [2147483647, 2147483647, 5];
}
const kept = [new Cursor([9, 8, 7]), new Wide([6, 5, 4, 3])];
function once(name: string, kind: number, start: number): string {
  const c = start === 2 ? new Wide(list(kind)) : new Cursor(list(kind));
  c.pos = start;
  const endless = start !== start && ["not eof", "has next", "left", "beyond"].includes(name);
  const answer = endless ? "" : call(name, c);
  return `${Object.is(answer, -0) ? "-0" : answer}@${Object.is(c.pos, -0) ? "-0" : c.pos}`;
}
for (const name of spellings) {
  const found: string[] = [];
  for (let kind = 0; kind < 6; kind++) found.push(once(name, kind, 0), once(name, kind, 2), once(name, kind, -1), once(name, kind, -0), once(name, kind, 0.5), once(name, kind, NaN), once(name, kind, 2147483646), once(name, kind, 9007199254740991));
  console.log(name, found.join(" "));
}

class Stack {
  items = new Int32Array(8);
  top = 0;
  push(value: number): void { this.items[this.top++] = value; }
  pop(): number { return this.items[--this.top]; }
  put(index: number, value: number): void { this.items[index] = value; }
  at(index: number): number { return this.items[index]; }
}
function reckon(s: Stack, n: number): string {
  let seen = 0;
  for (let k = 0; k < 6; k++) { s.push(k); s.push(n); s.push(s.pop() + s.pop()); if (k === 3) s.top += 3; if (k === 4) seen = s.pop() + s.pop(); s.push(s.pop() - s.pop()); }
  return `${seen}:${s.top}:${s.items.join()}`;
}
function spread(s: Stack, n: number): string {
  for (let k = 0; k < 8; k++) { s.put(k, s.at(k) + s.at(k + n)); s.put(7 - k, s.at(k - 2) - s.at(k)); }
  return s.items.join();
}
for (const n of [1, -5, 2147483647, 5]) {
  const s = new Stack();
  console.log("stack", n, reckon(s, n), reckon(s, n), spread(s, n), spread(s, n & 3));
}
export {};
