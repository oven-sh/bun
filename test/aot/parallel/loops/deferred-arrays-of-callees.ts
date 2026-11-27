// Constant arrays of the file that functions called in loops read and store: before their own line, frozen, with holes, aliased, grown by the loop, held by others, with loops that run no iteration, in several functions and nests.
const show = (v: any) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v));
function attempt(f: () => any): void {
  try {
    console.log(show(f()));
  } catch (error: any) {
    console.log(error.name);
  }
}
function daysIn(month: any): any {
  return days[month];
}
function next(): any {
  state[0] = (state[0] * 1103515245 + 12345) & 0x7fffffff;
  return state[0];
}
function pick(i: any): any {
  return i & 1 ? words[i % 3] : mixed[i & 3];
}
function note(i: any): any {
  seen[i & 3]++;
  if (i === 20) seen.push(1.5);
  return seen.length;
}
function frozenAt(i: any): any {
  if (i === 3) fixed[0] = 9;
  return fixed[i & 1];
}
function both(i: any): any {
  return daysIn(i % 12) + state[0] % 7;
}
function run(k: number): any {
  let s = 0;
  for (let i = 0; i < k; i++) s = (s + daysIn(i % 13)) | 0;
  return s;
}
function draw(k: number): any {
  let s = 0;
  for (let i = 0; i < k; i++) s ^= next();
  return s;
}
function spell(k: number): string {
  let s = "";
  for (let i = 0; i < k; i++) s = pick(i) + s.length;
  return s;
}
function tally(k: number): any {
  let s = 0;
  for (let i = 0; i < k; i++) s += note(i * 3);
  return s;
}
function nested(k: number): any {
  let s = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < 5; j++) s = (s + both(i + j) + (j > 3 ? next() & 3 : 0)) | 0;
  return s;
}
function refuse(k: number): any {
  let s = 0;
  for (let i = 0; i < k; i++) s += frozenAt(i);
  return s;
}
attempt(() => run(0));
attempt(() => run(3));
attempt(() => draw(2));
const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const state = [12345];
const words = ["a", "bc", "def"];
const mixed = [1, 2.5, "x", , 4];
const seen = [0, 0, 0, 0];
const fixed = Object.freeze([1, 2]) as number[];
attempt(() => run(0));
attempt(() => run(100));
attempt(() => draw(0));
attempt(() => draw(1000));
attempt(() => spell(30));
attempt(() => tally(40));
attempt(() => nested(9));
attempt(() => refuse(3));
attempt(() => refuse(9));
const alias = state;
alias[0] = 7.5;
attempt(() => draw(10));
state.length = 0;
attempt(() => draw(3));
days[4] = "May" as any;
attempt(() => run(20));
console.log(show(state), show(seen), show(words), show(days));
