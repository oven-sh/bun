// A loop, a pattern, a spread and a yield* step a generator without calling next and without an object for each step: what is yielded, sent and returned, early exits, bodies that throw, generators that have ended or are running.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function* count(limit: number): Generator<number, string> { for (let number = 0; number < limit; number++) yield number; return "returned"; }
function sum(iterable: Generator<number>) { let total = 0; for (const number of iterable) total += number; return total; } // @ts-expect-error
for (let turn = 0; turn < 3; turn++) report(sum(count(5 + turn))); // @ts-expect-error
report(sum([1, 2, 3] as any)); // @ts-expect-error
report(sum(new Set([4, 5]) as any));
const ended = count(2); // @ts-expect-error
report(sum(ended)); // @ts-expect-error
report(sum(ended));
const begun = count(4);
begun.next(); // @ts-expect-error
report(sum(begun));
let running: Generator<number>; // @ts-expect-error
function* stepsItself(): Generator<number> { yield 1; try { for (const value of running) report("never " + value); } catch (error: any) { report(error.name); } yield 2; }
running = stepsItself(); // @ts-expect-error
for (const value of running) report(value);
function* guarded(log: string[]): Generator<string> { try { yield "first"; yield "second"; } finally { log.push("cleaned up"); } }
function takeOne(iterable: Generator<string>, log: string[]) { for (const value of iterable) { log.push(value); break; } log.push("behind the loop"); return log.join(", "); } // @ts-expect-error
report(takeOne(guarded([]), [])); // @ts-expect-error
{ const log: string[] = []; report(takeOne(guarded(log), log)); }
function throwInLoop(iterable: Generator<string>, log: string[]) { try { for (const value of iterable) { log.push(value); throw new RangeError("out of the loop"); } } catch (error: any) { log.push(error.message); } return log.join(", "); } // @ts-expect-error
{ const log: string[] = []; report(throwInLoop(guarded(log), log)); }
function* failing() { yield 1; throw new TypeError("thrown by the body"); }
function collect(iterable: Generator<unknown>) { const seen: unknown[] = []; try { for (const value of iterable) seen.push(value); } catch (error: any) { seen.push(error.name + ": " + error.message); } return seen.join(", "); }
const failed = failing(); // @ts-expect-error
report(collect(failed)); // @ts-expect-error
report(collect(failed));
function* odd() { yield undefined; yield null; yield -0; yield NaN; yield { done: true, value: "looks like a result" }; yield [1, 2]; yield Promise; } // @ts-expect-error
for (const value of odd()) report(typeof value === "object" && value ? JSON.stringify(value) : typeof value === "function" ? value.name : (value as any)); // @ts-expect-error
function* echoes(): Generator<string, void, unknown> { const first = yield "ask"; report("sent " + first); const second = yield "ask again"; report("sent " + second); } // @ts-expect-error
for (const value of echoes()) report(value); // @ts-expect-error
function* inner(): Generator<string, string, unknown> { const sent = yield "inner 1"; report("inner got " + sent); yield "inner 2"; return "what inner returns"; } // @ts-expect-error
function* outer(): Generator<unknown, void, unknown> { yield "outer 1"; const returned = yield* inner(); report(returned); yield* [10, 20]; yield* "ab"; yield "outer 2"; } // @ts-expect-error
report(collect(outer()));
const stepped = outer(); // @ts-expect-error
report(JSON.stringify(stepped.next("a"))); // @ts-expect-error
report(JSON.stringify(stepped.next("b"))); // @ts-expect-error
report(JSON.stringify(stepped.next("c"))); // @ts-expect-error
report(JSON.stringify(stepped.return("left"))); // @ts-expect-error
report(JSON.stringify(stepped.next("d")));
function* delegatesWithCleanup(log: string[]): Generator<string> { try { yield* guarded(log); } finally { log.push("outer cleaned up"); } } // @ts-expect-error
{ const log: string[] = []; report(takeOne(delegatesWithCleanup(log), log)); } // @ts-expect-error
{ const log: string[] = []; const generator = delegatesWithCleanup(log); generator.next(); try { generator.throw(new Error("thrown in")); } catch (error: any) { log.push(error.message); } report(log.join(", ")); }
const [one, two, ...rest] = count(5); // @ts-expect-error
report(one + " " + two + " " + rest);
const [only] = guarded([]); // @ts-expect-error
report(only); // @ts-expect-error
report([...count(3), ...count(2)].join()); // @ts-expect-error
report(Math.max(...count(4))); // @ts-expect-error
report(Array.from(count(3)).join()); // @ts-expect-error
report(new Set(count(3)).size); // @ts-expect-error
report(Object.fromEntries((function* () { yield ["a", 1]; yield ["b", 2]; })() as any).b); // @ts-expect-error
report("end");
