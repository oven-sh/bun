// Flags in front of calls of functions of the file, in loops that a loop around has tested the list for; functions chosen when the program starts, called in such loops.
// STATISTIC: LoopsUnswitched >= 2
const list: number[] = JSON.parse("[" + Array.from({ length: 64 }, (_, k) => (k * 37) % 101).join() + "]");
const halves = list.map(x => x / 2), mixed: any[] = JSON.parse('[1,2,"a",4,null,6,7.5,8]');
const said: string[] = []; let sink: any = 0;
function say(...rest: unknown[]): void { said.push(rest.map(String).join(" ")); if (said.length > 60) said.length = 0; }
function twice(x: any): any { return x * 2; } function next(x: any): any { return x + 1; } function loud(x: any): any { say(x); return x; }
const hard = JSON.parse('{"on":true,"off":false,"pick":1}');
const on: boolean = hard.on, off: boolean = hard.off; let late = false; const holder = { on: false, off: true };
const chosen = hard.pick === 1 ? twice : next, other = hard.pick === 2 ? twice : next, noisy = hard.pick === 1 ? loud : next; let turning = next; if (hard.pick === 3) turning = twice;
export function change(flag: boolean): void { late = flag; turning = flag ? twice : next; }
function report(name: string, body: () => unknown): void {
  let got: unknown;
  try { got = body(); } catch (error) { got = (error as Error).name; }
  console.log(name, String(got), said.length, said.at(-1), String(sink)); said.length = 0; sink = 0;
}
function run0list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (off) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("0 list", run0list); change(false);
function run0halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; if (off) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("0 halves", run0halves); change(false);
function run0mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; if (off) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("0 mixed", run0mixed); change(false);
function run1list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (on) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("1 list", run1list); change(false);
function run1halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; if (on) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("1 halves", run1halves); change(false);
function run1mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; if (on) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("1 mixed", run1mixed); change(false);
function run2list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (late) say(x, i); s = (s + x) | 0; } return s + kept.join(); }
report("2 list", run2list); change(false);
function run2halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; if (late) say(x, i); s = (s + x) | 0; } return s + kept.join(); }
report("2 halves", run2halves); change(false);
function run2mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; if (late) say(x, i); s = (s + x) | 0; } return s + kept.join(); }
report("2 mixed", run2mixed); change(false);
function run3list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (holder.on) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("3 list", run3list); change(false);
function run3halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; if (holder.on) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("3 halves", run3halves); change(false);
function run3mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; if (holder.on) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("3 mixed", run3mixed); change(false);
function run4list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (!holder.off) say(x); kept[i & 7] = x; s = (s + x) | 0; } return s + kept.join(); }
report("4 list", run4list); change(false);
function run4halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; if (!holder.off) say(x); kept[i & 7] = x; s = (s + x) | 0; } return s + kept.join(); }
report("4 halves", run4halves); change(false);
function run4mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; if (!holder.off) say(x); kept[i & 7] = x; s = (s + x) | 0; } return s + kept.join(); }
report("4 mixed", run4mixed); change(false);
function run5list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (off && x > 3) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("5 list", run5list); change(false);
function run5halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; if (off && x > 3) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("5 halves", run5halves); change(false);
function run5mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; if (off && x > 3) say(x); s = (s + x) | 0; } return s + kept.join(); }
report("5 mixed", run5mixed); change(false);
function run6list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + chosen(x)) | 0; } return s + kept.join(); }
report("6 list", run6list); change(false);
function run6halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; s = (s + chosen(x)) | 0; } return s + kept.join(); }
report("6 halves", run6halves); change(false);
function run6mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; s = (s + chosen(x)) | 0; } return s + kept.join(); }
report("6 mixed", run6mixed); change(false);
function run7list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + other(x)) | 0; } return s + kept.join(); }
report("7 list", run7list); change(false);
function run7halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; s = (s + other(x)) | 0; } return s + kept.join(); }
report("7 halves", run7halves); change(false);
function run7mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; s = (s + other(x)) | 0; } return s + kept.join(); }
report("7 mixed", run7mixed); change(false);
function run8list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + turning(x)) | 0; } return s + kept.join(); }
report("8 list", run8list); change(false);
function run8halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; s = (s + turning(x)) | 0; } return s + kept.join(); }
report("8 halves", run8halves); change(false);
function run8mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; s = (s + turning(x)) | 0; } return s + kept.join(); }
report("8 mixed", run8mixed); change(false);
function run9list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s += noisy(x); } return s + kept.join(); }
report("9 list", run9list); change(false);
function run9halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; s += noisy(x); } return s + kept.join(); }
report("9 halves", run9halves); change(false);
function run9mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; s += noisy(x); } return s + kept.join(); }
report("9 mixed", run9mixed); change(false);
function run10list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + chosen(x) + other(x)) | 0; } return s + kept.join(); }
report("10 list", run10list); change(false);
function run10halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; s = (s + chosen(x) + other(x)) | 0; } return s + kept.join(); }
report("10 halves", run10halves); change(false);
function run10mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; s = (s + chosen(x) + other(x)) | 0; } return s + kept.join(); }
report("10 mixed", run10mixed); change(false);
function run11list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (late) sink = chosen(x); s = (s + x) | 0; if (r === 1 && i === 5) change(true); } return s + kept.join(); }
report("11 list", run11list); change(false);
function run11halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; if (late) sink = chosen(x); s = (s + x) | 0; if (r === 1 && i === 5) change(true); } return s + kept.join(); }
report("11 halves", run11halves); change(false);
function run11mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; if (late) sink = chosen(x); s = (s + x) | 0; if (r === 1 && i === 5) change(true); } return s + kept.join(); }
report("11 mixed", run11mixed); change(false);
function run12list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + turning(x)) | 0; if (r === 1 && i === 5) change(true); } return s + kept.join(); }
report("12 list", run12list); change(false);
function run12halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; s = (s + turning(x)) | 0; if (r === 1 && i === 5) change(true); } return s + kept.join(); }
report("12 halves", run12halves); change(false);
function run12mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; s = (s + turning(x)) | 0; if (r === 1 && i === 5) change(true); } return s + kept.join(); }
report("12 mixed", run12mixed); change(false);
function run13list(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; kept[i & 7] = chosen(x); s = (s + kept[i & 7]) | 0; } return s + kept.join(); }
report("13 list", run13list); change(false);
function run13halves(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < halves.length; i++) { const x = halves[i]!; kept[i & 7] = chosen(x); s = (s + kept[i & 7]) | 0; } return s + kept.join(); }
report("13 halves", run13halves); change(false);
function run13mixed(): any { let s: any = 0; const kept: any[] = [0, 0, 0, 0, 0, 0, 0, 0]; for (let r = 0; r < 4; r++) for (let i = 0; i < mixed.length; i++) { const x = mixed[i]!; kept[i & 7] = chosen(x); s = (s + kept[i & 7]) | 0; } return s + kept.join(); }
report("13 mixed", run13mixed); change(false);
