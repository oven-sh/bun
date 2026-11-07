// answers: with-library
// # loops that only read a list answer as plain code does whatever they are handed: lists of every kind of storage, with holes, below another list, with names and getters of their own, frozen, sparse, of a class below Array, and what is no list at all
// # the functions are called by value out of what unseen code holds, so each call comes through the guard into the unit that RUN(FORM) shows. Where the row in front of the loop fails, the closed copy answers
// # f2 = countsTexts, f3 = sums, f4 = countsWhatIsAbsent, f5 = weighs, f6 = looksBelowZero, f7 = sumsAgainAndAgain, f8 = literal, f1 = tell, f9 = all
// # RUN(FORM): walk f2 mechanisms=all
// # REQUIRES(FORM): entries-of-bun
// # FORM-LABEL: code f2:Body
// # FORM: = IsPristine {{*}}builtinClass=Array
// # FORM: = HasArrayStorage {{*}}arrayStorage=Contiguous
// # FORM: = GetArrayElement {{*}}arrayStorage=Contiguous level=Proven
// # RUN(NUMBERS): walk f3 mechanisms=all
// # REQUIRES(NUMBERS): entries-of-bun
// # NUMBERS-LABEL: code f3:Body
// # NUMBERS: = HasArrayStorage {{*}}arrayStorage=Double
// # NUMBERS: = GetArrayElement {{*}}arrayStorage=Double level=Proven
// # RUN(ANYTHING): walk f5 mechanisms=all
// # REQUIRES(ANYTHING): entries-of-bun
// # ANYTHING-LABEL: code f5:Body
// # ANYTHING: = IsPristine {{*}}builtinClass=Array
// # ANYTHING: = GetArrayElement {{*}}level=Proven
// # RUN(BELOW): walk f6 mechanisms=all
// # REQUIRES(BELOW): entries-of-bun
// # BELOW-LABEL: code f6:Body
// # BELOW: = IsPristine {{*}}builtinClass=Array aspects=[Storage, Names]
// # BELOW: = GetArrayElement {{*}}level=Proven
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 335 of 335 of 335
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-LoopInvariants $SHELL
// # REQUIRES(ALSO1): entries-of-bun
// # ALSO1: 335 of 335 of 335
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses $SHELL
// # REQUIRES(ALSO2): entries-of-bun
// # ALSO2: 335 of 335 of 335
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-ParameterGuards $SHELL
// # REQUIRES(ALSO3): entries-of-bun
// # ALSO3: 335 of 335 of 335
// # ALSO3-NEXT: exited with 0
// # RUN(ALSO4): run-in-shell mechanisms=-UnboxedNumbers $SHELL
// # REQUIRES(ALSO4): entries-of-bun
// # ALSO4: 335 of 335 of 335
// # ALSO4-NEXT: exited with 0
declare function report(value: unknown): void;
function countsTexts(names: string[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) n += names[i & 7] ? 1 : 0; return n; }
function sums(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
function countsWhatIsAbsent(list: string[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) n += list[i] === undefined ? 1 : 0; return n; }
function weighs(list: unknown[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) { const element = list[i]; n = (n * 3 + (element === undefined ? 1 : element === null ? 2 : 0)) | 0; } return n; }
function looksBelowZero(list: string[], turns: number): number { let n = 0; for (let i = -2; i < turns; i++) n += list[i] === undefined ? 1 : 0; return n; }
function sumsAgainAndAgain(list: number[], rounds: number): number { let s = 0; for (let k = 0; k < rounds; k++) { for (let i = 0; i < list.length; i++) s += list[i] + list[k & 1]; } return s; }
function literal(): number[] { return [1, 2, 3]; }
(globalThis as any).kept = [countsTexts, sums, countsWhatIsAbsent, weighs, looksBelowZero, sumsAgainAndAgain];
const kept = (globalThis as any).kept;
let hits = 0;
function tell(run: () => unknown) { try { report(String(run())); } catch (error) { report((error as Error).name); } report(hits); }
function all(value: any) { tell(() => kept[0](value, 10)); tell(() => kept[1](value)); tell(() => kept[2](value, 6)); tell(() => kept[3](value, 6)); tell(() => kept[4](value, 3)); tell(() => kept[5](value, 3)); }
all(["a", "", "c", "d", "", "f", "g", "h"]);
all([1, 2, 3]);
all([1.5, 2, -0, NaN]);
all([]);
all([{ }, null, undefined, "text", 4]);
all(literal());
all([1, , 3]);
all(["a", , "c"]);
all(new Array(5));
const above: any = [];
above[1] = 5;
const standsBelowAnotherList: any = [1, , 3];
Object.setPrototypeOf(standsBelowAnotherList, above);
all(standsBelowAnotherList);
const textsBelowAnotherList: any = ["a", , "c"];
Object.setPrototypeOf(textsBelowAnotherList, above);
all(textsBelowAnotherList);
const withoutPrototype: any = [1, 2, 3];
Object.setPrototypeOf(withoutPrototype, null);
all(withoutPrototype);
const named: any = ["a", "b"];
named[-1] = "below zero";
named.extra = 1;
all(named);
const withGetter: any = [1, 2, 3];
Object.defineProperty(withGetter, 1, { get() { hits++; return 7; } });
all(withGetter);
all(Object.freeze([1, 2, 3]));
all(Object.freeze(["a", "b"]));
const sparse: any = ["a"];
sparse[100000] = "far";
tell(() => kept[0](sparse, 10));
tell(() => kept[2](sparse, 6));
tell(() => kept[4](sparse, 3));
class Rows extends Array<number> { }
const rows = new Rows();
rows[0] = 4;
rows[1] = 5;
all(rows);
all(new Proxy([1, 2, 3], { get(target: any, key) { hits++; return target[key]; } }));
all(new Uint8Array([1, 2, 3]));
all(new Float64Array([1.5, 2.5]));
all({ length: 2, 0: 1, 1: 2 });
all("text");
all(null);
all(undefined);
tell(() => kept[0](null, 0));
tell(() => kept[2](undefined, 0));
all(7);
all(["a", "", "c", "d", "", "f", "g", "h"]);
all([1, 2, 3]);
report("end");
