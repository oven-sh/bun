// answers: without-library
// # a call of a module's variable that starts with one function and is seen to be given one other tests for each in turn, and whatever else is there is called as written
// # f6 = tell, f1 = gather, f2 = pick, f3 = first, f4 = second, f5 = current, f7 = setHook, f8 = makeHook
// # RUN(GIVEN): walk f5 mechanisms=all-Inlining
// # GIVEN: = TypeTest {{*}}testedType=f
// # GIVEN: = TypeTest {{*}}testedType=f
// # GIVEN: = Call {{*}}calleeName="hook"
// # RUN(NEVER): walk f5 mechanisms=all-Guesses
// # NEVER-NOT: = TypeTest {{*}}testedType=f
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function gather(from: number[], f: (x: number) => number): number { let sum = 0; for (let i = 0; i < from.length; i++) sum += f(from[i]); return sum; }
function pick(which: boolean): (x: number) => number { return which ? first : second; }
function first(x: number): number { return x + 1; }
function second(x: number): number { return x * 2; }
let hook: () => unknown = () => undefined;
function current(): unknown { const answer = hook(); return answer ?? "root"; }
function setHook(f: () => unknown): void { hook = f; }
function makeHook(n: number): () => unknown { return () => (n ? "made " + n : undefined); }
tell(() => gather([1, 2, 3], pick(true)));
tell(() => gather([1, 2, 3], pick(false)));
tell(() => gather([], pick(false)));
tell(() => current());
tell(() => current());
setHook(makeHook(1));
tell(() => current());
setHook(makeHook(2));
tell(() => current());
setHook(makeHook(0));
tell(() => current());
const others: any[] = [() => "a third", function (this: unknown) { return typeof this; }, Math.random.bind(null).constructor === Function ? String : String, 5, null, { call: 1 }, class { }, async () => 1];
hook = others[0];
tell(() => current());
hook = others[1];
tell(() => current());
hook = others[2];
tell(() => current());
hook = others[3];
tell(() => current());
hook = others[4];
tell(() => current());
hook = others[5];
tell(() => current());
hook = others[6];
tell(() => current());
hook = others[7];
tell(() => typeof current());
setHook(makeHook(3));
tell(() => current());
setHook(makeHook(4).bind(null));
tell(() => current());
let depth = 0;
setHook(() => (depth++ < 3 ? current() : "deep " + depth));
tell(() => current());
report("end");
