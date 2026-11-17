// STATISTIC: LocalArrayMethodEffectsNarrowed >= 3
// Pushes whose receiver is one of several arrays that the function has made, told apart by a condition; and beside them receivers that came from outside.
function shown(x: unknown): string { return Array.isArray(x) ? `[${x.length}:${Array.from({ length: x.length }, (_, i) => (i in x ? shown(x[i]) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }
let kept: any[] = [];

const halves = (list: number[]): string => { const even: number[] = [], odd: number[] = []; for (const x of list) (x % 2 === 0 ? even : odd).push(x); return `${shown(even)} ${shown(odd)}`; };
const thirds = (list: number[]): string => { const one: any[] = [], two: any[] = [0.5], three: any[] = ["t"]; for (let i = 0; i < list.length; i++) { const into = i % 3 === 0 ? one : i % 3 === 1 ? two : three; into.push(list[i]! * 2); into.push(list[i]! - 1); } return `${shown(one)} ${shown(two)} ${shown(three)}`; };
const outside = (list: number[], given: any): string => { const own: any[] = []; for (const x of list) (x === 1 ? given : own).push(x); return `${shown(own)} ${shown(given)}`; };
const handed = (list: number[]): string => { const one: any[] = [], two: any[] = []; let i = 0; for (const x of list) { if (i === 2) kept = one; (i++ & 1 ? one : two).push(x * 0.5, kept.length); } return `${shown(one)} ${shown(two)}`; };
const read = (list: number[]): string => { const one: any[] = [], two: any[] = []; let sum = 0, i = 0; for (const x of list) { (i++ & 1 ? one : two).push(x); sum += one.length * 10 + two.length; if (typeof two[0] === "number") sum += two[0]; } return `${shown(one)} ${shown(two)} ${sum}`; };
const same = (list: number[]): string => { const one: any[] = []; const two = list.length > 3 ? one : []; let i = 0; for (const x of list) { (i++ & 1 ? one : two).push(x); one.length > 5 && one.pop(); } return `${shown(one)} ${shown(two)}`; };

const lists = (): any[] => [[3, 1, 4, 1, 5], [2.5, -0, 0.5, NaN], [1, , 3], ["a", 1, {}], [], Array.from({ length: 30 }, (_, k) => k * 3), [1, "b", 2.5, null], Array.from({ length: 30 }, (_, k) => k / 2), new Set([1, 2.5, "c"])];
for (let l = 0; l < lists().length; l++) {
  kept = [];
  for (const f of [halves, thirds, handed, read, same]) console.log(l, f(veil(lists()[l])));
  for (const given of [[], [7], ["q"], [, 1], { push(x: any) { kept.push(x); } }]) console.log(l, outside(veil(lists()[l]), veil(given)), shown(kept));
}
