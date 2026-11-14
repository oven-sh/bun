// A view that a module variable holds is read under a counter with numbers added to it and taken from it.
const said: string[] = [];
function say(name: string, run: () => unknown): void {
  let value: unknown;
  try {
    value = run();
  } catch (error) {
    value = (error as Error).constructor.name;
  }
  said.push(name + " " + String(value));
}

const starts = new Int32Array([0, 2, 5, -3]);
const numbers: number[] = [0, 2, 5, -3];

function sumLate(start: number, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += late[start + i]!;
  return sum;
}
say("late before", () => sumLate(1, 3));
let late = new Uint16Array(12);
for (let i = 0; i < 12; i++) late[i] = i * 5 + 1;
say("late after", () => sumLate(1, 3));

let arena = new Uint16Array(12);
for (let i = 0; i < 12; i++) arena[i] = i * 3 + 1;
let grown = 0;
function isAt(id: number, text: string, from: number, to: number): boolean {
  const start = starts[id]!;
  for (let i = from; i < to; i++) if (arena[start + i - from] !== text.charCodeAt(i)) return false;
  return true;
}
function sumOffView(id: number, from: number, to: number): number {
  const start = starts[id]!;
  let sum = 0;
  for (let i = from; i < to; i++) sum += arena[start + i - from]!;
  return sum;
}
function sumOffList(id: number, from: number, to: number): number {
  const start = numbers[id]!;
  let sum = 0;
  for (let i = from; i < to; i++) sum += arena[start + i - from]!;
  return sum;
}
function fill(id: number, from: number, to: number): string {
  const start = starts[id]!;
  for (let i = from; i < to; i++) arena[start + i - from] = i * 7;
  return arena.join();
}
function grow(): void {
  const larger = new Uint16Array(arena.length + 2);
  larger.set(arena);
  arena = larger;
  grown++;
}
function push(from: number, to: number): string {
  let at = 10;
  for (let i = from; i < to; i++) {
    if (at + i - from >= arena.length) grow();
    arena[at + i - from] = i;
  }
  return arena.join() + " " + grown;
}
function compare(id: number, other: number, from: number, to: number): number {
  const a = starts[id]!, b = numbers[other]!;
  let same = 0;
  for (let i = from; i < to; i++) if (arena[a + i - from] === arena[b + i - from]) same++;
  return same;
}
function behind(from: number, to: number, back: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += i >= back ? arena[i - back]! : 100;
  return sum;
}
class Holder {
  view = new Float64Array(10);
  constructor() {
    for (let i = 0; i < 10; i++) this.view[i] = i / 4;
  }
  sum(start: number, from: number, to: number): number {
    let sum = 0;
    for (let i = from; i <= to; i++) sum += this.view[start - from + i]!;
    return sum;
  }
}
for (const id of [0, 1, 2, 3, 4, -1]) {
  for (const [from, to] of [[0, 4], [1, 5], [3, 15], [2, 2], [5, 2]] as const) {
    say(`view ${id} ${from} ${to}`, () => sumOffView(id, from, to));
    say(`list ${id} ${from} ${to}`, () => sumOffList(id, from, to));
    say(`compare ${id} ${from} ${to}`, () => compare(id, 3 - id, from, to));
  }
  say(`text ${id}`, () => isAt(id, "\u0001\u0004\u0007\u000a", 0, 4) + " " + isAt(id, "x\u0007\u000a\u000d", 1, 4));
}
for (const start of [0, 1.5, -1, 2 ** 31, 2 ** 53, NaN, undefined as any, "1" as any]) {
  say(`late ${String(start)}`, () => sumLate(start, 3));
  say(`field ${String(start)}`, () => new Holder().sum(start, 1, 4));
}
for (const back of [0, 1, 4, -2]) say(`behind ${back}`, () => behind(0, 9, back));
say("push", () => push(3, 9));
say("push more", () => push(0, 8));
for (const id of [0, 2, 3]) say(`fill ${id}`, () => fill(id, 1, 5));
const buffer = new ArrayBuffer(32, { maxByteLength: 64 });
arena = new Uint16Array(buffer);
for (let i = 0; i < 16; i++) arena[i] = i + 1;
function shrink(start: number, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += arena[start + i] ?? 1000;
    if (sum > 10) buffer.resize(8);
  }
  return sum;
}
say("shrunk", () => shrink(1, 8));
say("after", () => sumOffView(1, 0, 4));
structuredClone(buffer, { transfer: [buffer] });
say("detached", () => sumOffView(0, 0, 4));
console.log(said.join("\n"));
