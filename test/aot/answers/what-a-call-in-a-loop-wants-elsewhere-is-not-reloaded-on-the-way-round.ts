// answers: with-library
// # for (..) { if (each(items[i], a, b, c)) .. }: what the loop reads and did not make lies in registers at its head. The call takes those registers, so the edge that comes round reloaded each value into its register,
// # every turn. But the first to read some of them behind the head is the call itself, and it wants them in another register: nobody read the register that was reloaded; the value was moved, or loaded a second time.
// # Such a value gets its slot ahead of the loop and the head lets go of it: it is loaded once a turn, into the register that the call wants. (`some`, `filter` and `map` of the library: two instructions a turn.)
// # The callees lie under keys that nobody in sight knows: a written list of functions is entered function by function, and no such call is left.
// # RUN(THREE): allocate f1:Body mechanisms=all
// # REQUIRES(THREE): x86_64 as-written
// # THREE: reload {{*}} -> r12
// # THREE-NOT: Jump
// # THREE-NOT: Branch
// # THREE: = Patch
// # RUN(WHILE): allocate f3:Body mechanisms=all
// # REQUIRES(WHILE): x86_64 as-written
// # WHILE: reload {{*}} -> r12
// # WHILE-NOT: Jump
// # WHILE-NOT: Branch
// # WHILE: = Patch
// # No turn, one turn, many; a way out in the first turn and in the last; a callee that throws out of the loop and one that makes so much that the collector runs while the values lie in their slots alone;
// # callees that read `this` and every argument; the library's own loops.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;

const list: number[] = JSON.parse("[1,2,3,4,5,6,7,8]");
function handsThree(items: number[], each: any, a: unknown, b: unknown, c: unknown) { for (let i = 0; i < items.length; i++) { if (each(items[i], a, b, c)) return i; } return -1; }
function handsFour(items: number[], each: any, a: unknown, b: unknown, c: unknown, d: unknown) { let n = 0; for (let i = 0; i < items.length; i++) n += each(items[i], a, b, c, d) ? 1 : 0; return n; }
function whileCalls(each: any, a: unknown, b: unknown, c: unknown, limit: number) { let i = 0; while (i < limit && !each(i, a, b, c)) i++; return i; }
function attempt(run: () => unknown) { try { return run(); } catch (error) { return (error as Error).name + ": " + (error as Error).message; } }
const seen: string[] = [];
const named: any = JSON.parse("{}");
[(x: number, a: number, b: number, c: number) => x + a + b + c > 12, (x: number) => x < 0, (x: number) => x === 1, (x: number) => x === 8, (x: number, a: unknown, b: unknown, c: unknown, d: unknown) => { seen.push([x, a, b, c, d].join("/")); return false; }, (x: number, a: string) => { if (x === 5) throw new RangeError(a + " at " + x); return false; }, (x: number, a: unknown, b: unknown, c: unknown) => { const made: unknown[] = []; for (let k = 0; k < 400; k++) made.push({ x, a, b, c, k }); return made.length < x; }].forEach((each: any, i: number) => { named["call " + i] = each; });
const callees: any[] = JSON.parse("[0,1,2,3,4,5,6]").map((i: number) => named["call " + i]);
for (const each of callees) report([attempt(() => handsThree(list, each, 1, 2, 3)), attempt(() => handsFour(list, each, "a", "b", "c", "d")), attempt(() => whileCalls(each, 2, 2, 2, 12)), attempt(() => handsThree([], each, 1, 2, 3)), attempt(() => handsFour([9], each, 1, 2, 3, 4)), attempt(() => whileCalls(each, 1, 1, 1, 0))].join());
report(seen.length + " " + seen[0] + " " + seen[8] + " " + seen[seen.length - 1]);
const kept = { a: { name: "a" }, b: [1, 2], c: "text" + list.length };
let sum = 0;
for (let turn = 0; turn < 3000; turn++) sum += handsFour(list, callees[6], kept.a, kept.b, kept.c, turn) + handsThree(list, callees[turn % 4], kept.a, 2, 3) + whileCalls(callees[2 + (turn & 1)], kept.b, kept.c, 0, 10);
report(sum + " " + JSON.stringify(kept));
const bounds = { most: 6, least: 3 };
const tests: any[] = [function (this: any, x: number) { return x > this.most; }, function (this: any, x: number) { return x < this.least; }, function (this: any, x: number, at: number, all: number[]) { return all[at] !== x || this !== bounds; }];
for (const test of tests) report([list.some(test, bounds), list.every(test, bounds), list.filter(test, bounds).join("+"), list.map(test, bounds).join(""), list.find(test, bounds), list.findIndex(test, bounds), [].some(test, bounds), [7].some(test, bounds)].join());
report(attempt(() => list.some(function (this: any, x: number) { if (x === 4) throw new TypeError(String(this.most)); return false; }, bounds)));
report("end");
