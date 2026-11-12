// answers: without-library
// # In the typed copy of a loop a read off a list that was tested in front asks first whether the element is there, and the turn begins again in the other copy where it is not.
// # A position that has passed lies inside the list until something may shorten the list. So the two stores of a swap ask nothing, also under a key that may be negative by its type.
// # f1 = describe, f2 = tell, f3 = swap, f4 = cut, f5 = poke, f6 = flips
// # RUN(SWAP): walk f6 mechanisms=all-Inlining
// # SWAP-LABEL: code f6:Body
// # SWAP: [[first]]: boolean @Boolean = IsElementPresent {{*}} arrayStorage=Int32 [keyIsIntegral]
// # SWAP-NEXT: Branch [[first]]
// # SWAP: GetArrayElement {{*}} arrayStorage=Int32 level=Proven [keyIsIntegral, isPresent]
// # SWAP: [[key]]: int[-{{*}}] @{{*}} = Sub
// # SWAP-NEXT: [[second]]: boolean @Boolean = IsElementPresent {{*}}, [[key]], {{*}} arrayStorage=Int32 [keyIsIntegral]
// # SWAP-NEXT: Branch [[second]]
// # SWAP: GetArrayElement {{*}}, [[key]], {{*}} arrayStorage=Int32 level=Proven [keyIsIntegral, isPresent]
// # SWAP-NOT: Branch
// # SWAP: PutContiguousIndex
// # SWAP-NOT: Branch
// # SWAP: PutContiguousIndex {{*}}, [[key]],
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: exited with 0
declare function report(value: unknown): void;
function describe(list: any): string { let text = list.length + ":"; for (let i = 0; i < list.length && i < 12; i++) text += (i in list ? String(list[i]) : "hole") + ","; return text + " " + String(list[-1]) + " " + String(list[-2]); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function swap(list: number[], last: number, turns: number): void { for (let i = 0; i < turns; i++) { const kept = list[i]; list[i] = list[last - i]; list[last - i] = kept; } }
function cut(list: number[], last: number, turns: number, at: number): void { for (let i = 0; i < turns; i++) { const kept = list[i]; const other = list[last - i]; if (i === at) list.length = 1; list[i] = other; list[last - i] = kept; } }
function poke(list: number[], last: number, turns: number, between: (i: number) => void): void { for (let i = 0; i < turns; i++) { const kept = list[i]; const other = list[last - i]; between(i); list[i] = other; list[last - i] = kept; } }
function flips(count: number, filled: number, last: number, turns: number): string { const list: number[] = new Array(count); for (let i = 0; i < filled; i++) list[i] = i * 3; for (let i = 0; i < turns; i++) { const kept = list[i]; list[i] = list[last - i]; list[last - i] = kept; } let text = list.length + ":"; for (let i = 0; i < list.length && i < 12; i++) text += String(list[i]) + ","; return text; }
function whole(count: number): number[] { const list: number[] = new Array(count); for (let i = 0; i < count; i++) list[i] = i * 3; return list; }
function fractions(count: number): number[] { const list: number[] = []; for (let i = 0; i < count; i++) list.push(i + 0.5); return list; }
function after(list: number[], f: (list: number[]) => void): string { f(list); const first = describe(list); f(list); return first + " | " + describe(list); }
const makers: ((count: number) => number[])[] = [whole, fractions];
function swapEach(make: (count: number) => number[]): void { tell(() => after(make(6), list => swap(list, 5, 3))); tell(() => after(make(7), list => swap(list, 3, 2))); tell(() => after(make(4), list => swap(list, 5, 3))); tell(() => after(make(4), list => swap(list, 1, 3))); tell(() => after(make(4), list => swap(list, 1, 4))); tell(() => after(make(0), list => swap(list, 1, 2))); }
for (let m = 0; m < makers.length; m++) swapEach(makers[m]);
function named(make: (count: number) => number[]): number[] { const list: any = make(4); list[-1] = 7; list[-2] = 9; return list; }
for (let m = 0; m < makers.length; m++) tell(() => after(named(makers[m]), list => swap(list, 1, 4)));
function holed(make: (count: number) => number[], at: number): number[] { const list: any = make(6); delete list[at]; return list; }
for (let m = 0; m < makers.length; m++) for (let at = 0; at < 6; at++) tell(() => after(holed(makers[m], at), list => swap(list, 5, 3)));
for (let m = 0; m < makers.length; m++) for (let at = 0; at < 4; at++) tell(() => after(makers[m](6), list => cut(list, 5, 3, at)));
function pokeEach(make: (count: number) => number[], at: number): void { tell(() => after(make(6), list => poke(list, 5, 3, i => { if (i === at) list.length = 2; }))); tell(() => after(make(6), list => poke(list, 5, 3, i => { if (i === at) list.pop(); }))); tell(() => after(make(6), list => poke(list, 5, 3, i => { if (i === at) (list as any)[1] = "text"; }))); tell(() => after(make(6), list => poke(list, 5, 3, i => { if (i === at) Object.freeze(list); }))); }
for (let m = 0; m < makers.length; m++) for (let at = 0; at < 3; at++) pokeEach(makers[m], at);
for (let filled = 0; filled < 8; filled++) tell(() => flips(6, filled, 5, 3) + " | " + flips(7, filled, 3, 2) + " | " + flips(4, filled, 5, 3) + " | " + flips(4, filled, 1, 3) + " | " + flips(4, filled, 1, 4) + " | " + flips(0, filled, 1, 2));
report("end");
