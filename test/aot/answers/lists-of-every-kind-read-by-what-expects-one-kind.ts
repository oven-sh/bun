// answers: without-library
// # reads that are written of `string[]`, `number[]`, `unknown[]` meet lists of every kind of storage: texts, int32, doubles, none yet, shared with a literal, holes, far elements, accessors, frozen; lists below other lists and below nothing; a class below Array, Array.prototype itself, objects below it, proxies, views, texts, nothing
// # the program is that of lists-of-every-kind-read-in-loops-that-leave-them-alone.ir, with Array.prototype and what stands below it added: the test of the kind by its bits takes a cell without storage for elements for Contiguous
// # the turn of countsTextsBesideACall calls what nobody knows, so no row stands in front of its loop and the read tests for itself in every turn
// # f8 = countsTextsBesideACall
// # RUN(FORM): walk f8 mechanisms=all
// # FORM-LABEL: code f8:Body
// # FORM: = GetArrayElement {{*}}arrayStorage=Contiguous level=Expected
// # the byte is masked with the bits that every other kind has, and the branch goes by what is left: no compare
// # RUN(BITS): emit f8 mechanisms=all
// # BITS: [[byte]] = Load8Z({{*}}JSArray_indexingTypeAndMisc
// # BITS-NEXT: [[bits]] = BitAnd(@[[byte]],
// # BITS: Branch(@[[bits]],
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 431 of 431 of 431
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO1: 431 of 431 of 431
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO2: 431 of 431 of 431
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO3: 431 of 431 of 431
// # ALSO3-NEXT: exited with 0
// # RUN(ALSO4): run-in-shell mechanisms=-ParameterGuards-LoopInvariants $SHELL
// # ALSO4: 431 of 431 of 431
// # ALSO4-NEXT: exited with 0
declare function report(value: unknown): void;
function countsTexts(names: string[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) n += names[i & 7] ? 1 : 0; return n; }
function sums(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
function countsWhatIsAbsent(list: string[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) n += list[i] === undefined ? 1 : 0; return n; }
function weighs(list: unknown[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) { const element = list[i]; n = (n * 3 + (element === undefined ? 1 : element === null ? 2 : 0)) | 0; } return n; }
function looksBelowZero(list: string[], turns: number): number { let n = 0; for (let i = -2; i < turns; i++) n += list[i] === undefined ? 1 : 0; return n; }
function sumsAgainAndAgain(list: number[], rounds: number): number { let s = 0; for (let k = 0; k < rounds; k++) { for (let i = 0; i < list.length; i++) s += list[i] + list[k & 1]; } return s; }
let calls = 0;
function countsTextsBesideACall(names: string[], turns: number, tells: () => void): number { let n = 0; for (let i = 0; i < turns; i++) { n += names[i & 7] ? 1 : 0; tells(); } return n; }
function literal(): number[] { return [1, 2, 3]; }
(globalThis as any).kept = [countsTexts, sums, countsWhatIsAbsent, weighs, looksBelowZero, sumsAgainAndAgain, countsTextsBesideACall];
const kept = (globalThis as any).kept;
let hits = 0;
function tell(run: () => unknown) { try { report(String(run())); } catch (error) { report((error as Error).name); } report(hits); }
function all(value: any) { tell(() => kept[0](value, 10)); tell(() => kept[1](value)); tell(() => kept[2](value, 6)); tell(() => kept[3](value, 6)); tell(() => kept[4](value, 3)); tell(() => kept[5](value, 3)); tell(() => kept[6](value, 10, () => { calls++; })); }
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
all(Array.prototype);
all(Object.create(Array.prototype));
all(Object.create(["a", "b", "c"]));
all(["a", "", "c", "d", "", "f", "g", "h"]);
all([1, 2, 3]);
report("end");
