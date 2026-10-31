// Copies by spread and by Array.from, of every storage and of lists with holes: then written, grown, read, and copied from lists that change between copies.
const out: string[] = [];
const show = (label: string, value: unknown) => out.push(`${label}: ${JSON.stringify(value)}`);
const whole: number[] = Array.from({ length: 8 }, (_, k) => k);
const fractions: number[] = Array.from({ length: 8 }, (_, k) => k + 0.5);
const texts: string[] = ["a", "b", "c"];
const none: number[] = [];
const one: number[] = [1];
const big: number[] = Array.from({ length: 2000 }, (_, k) => k);
function copy<T>(list: T[]): T[] { const made = [...list]; return made; }
function written(list: number[], i: number): number[] { const made = [...list]; made[i] = 0.5; return made; }
function pushed(list: number[]): number[] { const made = [...list]; made.push(99); return made; }
function strange(list: number[]): unknown[] { const made: unknown[] = [...list]; made[0] = "text"; return made; }
function shrunk(list: number[]): number[] { const made = [...list]; made.length = 1; made[3] = 7; return made; }
function pair(a: number[]): number { const made = [...a]; return made[0]! + made.length; }
function kept(list: number[]): boolean { const made = [...list]; return made !== list && Array.isArray(made) && Object.getPrototypeOf(made) === Array.prototype; }
for (const list of [whole, fractions, none, one]) show("each", [copy(list), written(list, 0), pushed(list), strange(list), shrunk(list), kept(list), list]);
show("texts", copy(texts)); show("big", copy(big).length + copy(big)[1999]!);
const changing: number[] = [1, 2]; const before = copy(changing); changing.push(3); changing[0] = 0.25; show("changing", [before, copy(changing)]);
let sum = 0; for (let i = 0; i < 100000; i++) sum += pair(whole) + written(whole, i & 7)[i & 7]!; show("sum", sum);
function twice(list: number[]): number[] { return [...list, ...list]; }
function withOne(list: number[], last: number): number[] { return [...list, last]; }
for (const list of [whole, fractions, none, one]) show("two", [twice(list), withOne(list, 7)]);
// A list that is seen before the elements come in.
let seen: number[] = [];
function seenFirst(list: number[]): number { seen = []; seen.push(...list); seen.push(list.length); return seen.length; }
let atTheTop: number[] = [];
atTheTop.push(...whole);
show("seen", [seenFirst(whole), seen, atTheTop]);
// A copy that reads undefined out of a hole, by either spelling.
const holes: number[] = [1, 2, , 4.5, , 6] as number[];
function fromHoles(list: number[], i: number): number[] { const made = Array.from(list); made[i] = 0.25; made.push(i); return made; }
function spreadHoles(list: number[], i: number): number[] { const made = [...list]; made[i] = 0.25; made.push(i); return made; }
let holesSeen = 0; for (let i = 0; i < 20000; i++) holesSeen += (fromHoles(holes, i & 3)[2] ?? 1) + (spreadHoles(holes, i & 3)[4] ?? 2);
show("holes", [Array.from(holes), [...holes], fromHoles(holes, 2), spreadHoles(holes, 5), 2 in Array.from(holes), holesSeen]);
console.log(out.join("\n"));
