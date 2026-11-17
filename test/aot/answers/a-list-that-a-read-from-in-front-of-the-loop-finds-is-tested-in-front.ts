// answers: without-library
// # `for (..) s += holder.values[i]`: the list is no value from in front of the loop: each turn reads it anew, off a field, a module's variable or a captured variable.
// # Where the turns of the typed build write neither that place nor a list, the read leaves the loop by the rules that stand, and at the list's first read its tests are laid in front as well:
// # is it as made, has it the storage that its written type says. Where one fails the other copy runs. The try holds the turns' effects, so a turn that pushes, swaps the list or runs other code gets no such build.
// # f1 = id, f2 = sumOfHolder, f3 = sumOfModuleVariable, f4 = sumAndCount, f5 = sumWhileItGrows, f6 = sumWhileTheListIsSwapped, f7 = sumWhileTheVariableIsSwapped
// # RUN(FIELD): walk f2 mechanisms=all
// # FIELD: number @Double{{*}}isInLoop=true isLoopHead=true
// # FIELD: = HasArrayStorage {{*}}arrayStorage=Double
// # RUN(VARIABLE): walk f3 mechanisms=all
// # VARIABLE: number @Double{{*}}isInLoop=true isLoopHead=true
// # VARIABLE: = HasArrayStorage {{*}}arrayStorage=Double
// # a store into another field of the holder ends nothing
// # RUN(COUNTS): walk f4 mechanisms=all
// # COUNTS: number @Double{{*}}isInLoop=true isLoopHead=true
// # COUNTS: = HasArrayStorage {{*}}arrayStorage=Double
// # RUN(GROWS): walk f5 mechanisms=all
// # the list that such a turn finds is asked in that turn, in front of each read, as in f7: nothing of it is laid in front or kept
// # GROWS-NOT: = GetArrayStorage
// # RUN(SWAPPED): walk f6 mechanisms=all
// # SWAPPED-NOT: = GetArrayStorage
// # Where the turns swap the variable nothing is laid in front either: the list that each turn finds is asked in that turn, and nothing of it is kept from in front.
// # RUN(ASKED): walk f7 mechanisms=all
// # ASKED: = HasArrayStorage {{*}}arrayStorage=Double
// # RUN(KEPT): walk f7 mechanisms=all
// # KEPT-NOT: = GetArrayStorage
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
type Holder = { values: number[]; n: number };
let shared: number[] = [];
function sumOfHolder(holder: Holder): number { let s = 0; for (let i = 0; i < holder.values.length; i++) s += holder.values[i]; return s; }
function sumOfModuleVariable(): number { let s = 0; for (let i = 0; i < shared.length; i++) s += shared[i]; return s; }
function sumAndCount(holder: Holder): number { let s = 0; for (let i = 0; i < holder.values.length; i++) { s += holder.values[i]; holder.n++; } return s; }
function sumWhileItGrows(holder: Holder): number { let s = 0; for (let i = 0; i < holder.values.length; i++) { s += holder.values[i]; if (s === 3) holder.values.push(7); } return s; }
function sumWhileTheListIsSwapped(holder: Holder, other: number[]): number { let s = 0; for (let i = 0; i < holder.values.length; i++) { s += holder.values[i]; if (i === 1) holder.values = other; } return s; }
function sumWhileTheVariableIsSwapped(other: number[]): number { let s = 0; for (let i = 0; i < shared.length; i++) { s += shared[i]; if (i === 0) shared = other; } return s; }
function makeReader(): { set(list: number[]): void; sum(): number } { let held: number[] = []; return { set(list: number[]): void { held = list; }, sum(): number { let s = 0; for (let i = 0; i < held.length; i++) s += held[i]; return s; } }; }
const doubles: number[] = id([1.5, 2, 3.25]);
const integers: number[] = id([1, 2, 3, 4]);
report([sumOfHolder(id({ values: doubles, n: 0 })), sumOfHolder(id({ values: integers, n: 0 })), sumOfHolder(id({ values: [], n: 0 }))].join(" "));
report([sumOfHolder(id({ values: ["a", 1] as any, n: 0 })), sumOfHolder(id({ values: [1, , 3] as any, n: 0 })), sumOfHolder(id({ n: 0, values: doubles }))].join(" "));
const withGetter: Holder = id({ n: 0 } as any);
let reads = 0;
Object.defineProperty(withGetter, "values", { get() { reads++; return reads > 3 ? integers : doubles; } });
report(sumOfHolder(withGetter) + " " + reads);
let thrown = "";
try { sumOfHolder(id({ n: 0 } as any)); } catch (error) { thrown = (error as Error).constructor.name; }
report(thrown);
shared = doubles; report(sumOfModuleVariable());
shared = integers; report(sumOfModuleVariable());
shared = id(["x", 2] as any); report(sumOfModuleVariable());
const counted: Holder = id({ values: doubles, n: 0 });
report(sumAndCount(counted) + " " + counted.n);
const self: any = id({ values: null, n: 0 }); self.values = [1, 2, 3]; Object.defineProperty(self, "n", { get() { return 0; }, set(v) { self.values = [10, 20, 30, 40]; } });
report(sumAndCount(self));
report([sumWhileItGrows(id({ values: [1, 2, 3], n: 0 })), sumWhileItGrows(id({ values: [3], n: 0 })), sumWhileItGrows(id({ values: [1.5], n: 0 }))].join(" "));
report([sumWhileTheListIsSwapped(id({ values: [1, 2, 3], n: 0 }), id([10, 20, 30, 40])), sumWhileTheListIsSwapped(id({ values: [1, 2, 3], n: 0 }), id([])), sumWhileTheListIsSwapped(id({ values: [1, 2, 3], n: 0 }), id(["a", "b", "c"] as any))].join(" "));
shared = id([1, 2, 3]); report(sumWhileTheVariableIsSwapped(id([10, 20, 30, 40])));
const reader = id(makeReader());
report(reader.sum()); reader.set(doubles); report(reader.sum()); reader.set(id(["s"] as any)); report(reader.sum());
report("end");
