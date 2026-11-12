// at() by name in a program whose receivers are no arrays: texts, views, numbers, objects with a method of that name, and nothing.
const attempt = (f: () => unknown): string => { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } };
function byName(a: any, k: any): any { return a.at(k); }
function inLoop(a: any): string { let t = ""; for (let i = -2; i < 3; i++) t += a.at(i) + ","; return t; }
const receivers: any[] = ["abc", "", new Uint8Array([1, 2, 3]), 5, true, { at: (k: number) => "own" + k }, {}, null, undefined, Symbol.iterator, 5n, () => 1, new Map(), class { static at(k: number): string { return "static" + k; } }];
for (let round = 0; round < 3; round++) console.log(receivers.map(r => attempt(() => byName(r, -1)) + attempt(() => byName(r, 1)) + attempt(() => inLoop(r))).join("|"));
