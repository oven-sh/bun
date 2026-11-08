// answers: without-library
// # `function make(data: number[]) { return () => { for (..) s += data[i] } }`: a capture by value arrives as an entry parameter of the closure's body, and nothing was expected of it:
// # Link wrote what is written of a parameter as its expectation and gave a capture what is proven alone. So nothing tested the list in front of the loop, and every turn read it by the operation that tests for itself: 85.3 instructions a turn for 7.5.
// # Now what is written of a capture is expected of it as of a parameter, and is tested where it is used: whatever else arrives takes the other copy.
// # f1 = id, f2 = makeSum, f3 = makeSumOfTwo, f4 = the closure that makeSum makes, f5 = the one that makeSumOfTwo makes
// # RUN(LIST): walk f4 mechanisms=all
// # LIST: = TypeTest v0 testedType=Array<number>
// # LIST: = HasArrayStorage {{*}}arrayStorage=Double
// # LIST: number @Double{{*}}isInLoop=true isLoopHead=true
// # RUN(TWO): walk f5 mechanisms=all
// # TWO: = HasArrayStorage {{*}}arrayStorage=Double
// # TWO: = HasArrayStorage {{*}}arrayStorage=Double
// # TWO: number @Double{{*}}isInLoop=true isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function makeSum(data: number[]): () => number { return () => { let s = 0; for (let i = 0; i < data.length; i++) s += data[i]; return s; }; }
function makeSumOfTwo(first: number[], second: number[]): () => number { return () => { let s = 0; for (let i = 0; i < first.length; i++) s += first[i] + second[i]; return s; }; }
const doubles: number[] = id([1.5, 2, 3.25]);
const integers: number[] = id([1, 2, 3, 4]);
report([id(makeSum(doubles))(), id(makeSum(integers))(), id(makeSum(id([])))()].join(" "));
report([id(makeSum(id(["a", 1] as any)))(), id(makeSum(id([1, , 3] as any)))(), id(makeSum(id("123" as any)))()].join(" "));
report(id(makeSum(id({ length: 2, 0: 5, 1: 6 } as any)))());
let thrown = "";
try { id(makeSum(id(undefined as any)))(); } catch (error) { thrown = (error as Error).constructor.name; }
report(thrown);
const grown: number[] = id([1, 2]);
const sumOfGrown = id(makeSum(grown));
report(sumOfGrown()); grown.push(3.5); report(sumOfGrown());
report([id(makeSumOfTwo(doubles, integers))(), id(makeSumOfTwo(integers, doubles))(), id(makeSumOfTwo(doubles, id(["x", "y", "z"] as any)))()].join(" "));
report("end");
