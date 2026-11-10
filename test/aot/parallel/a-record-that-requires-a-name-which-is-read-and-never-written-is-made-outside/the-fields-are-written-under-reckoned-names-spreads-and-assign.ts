// Nobody writes `left` by its name: it is laid under a name that is reckoned, by a spread of what JSON gave, by Object.assign, by Object.defineProperty, by Reflect.set and by a class field of an heir that the record's type does not name.
interface Pair { kind: string; left: number[]; right: number[] }
const said: (string | number)[] = [];
function sum(pair: Pair): number { let s = 0; for (let i = 0; i < pair.left.length; i++) s += pair.left[i]!; for (let i = 0; i < pair.right.length; i++) s += pair.right[i]! * 2; return s; }
const table: Record<string, (pair: Pair) => number> = { sum };
const names: string[] = JSON.parse('["le","ft","ri","ght"]');
function reckoned(): any { const o: any = { kind: "reckoned" }; o[names[0]! + names[1]!] = [1, 2]; o[names[2]! + names[3]!] = [3]; return o; }
function spread(): any { return { kind: "spread", ...JSON.parse('{"left":[4],"right":[5,6]}') }; }
function assigned(): any { return Object.assign({ kind: "assigned" }, JSON.parse('{"left":[7],"right":[8]}')); }
function defined(): any { const o: any = { kind: "defined" }; Object.defineProperty(o, names[0]! + names[1]!, { value: [9], enumerable: true }); Reflect.set(o, names[2]! + names[3]!, [10]); return o; }
function gotten(): any { const o: any = { kind: "gotten" }; Object.defineProperty(o, names[0]! + names[1]!, { get() { return [11, 12]; } }); Object.defineProperty(o, names[2]! + names[3]!, { get() { return [13]; } }); return o; }
for (let round = 0; round < 3; round++) for (const make of [reckoned, spread, assigned, defined, gotten]) said.push(table[JSON.parse('"sum"') as string]!(make()));
console.log(said.join(" "));
export {};
