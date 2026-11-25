// answers: without-library
// # a loop steps a generator where `next` is the engine's own: one that goes on, one that has ended, one that is running (it steps itself: TypeError), one that return() has closed
// # only generators come to each() in plain sight: beside an iterator of another layout what is expected of the parameter names no one class (what is written is united with what was seen), and the arm that steps a generator is not built
// # f1 = count, f2 = each
// # LIBRARY: own
// # RUN(FORM): walk f2 mechanisms=none+TypedOperations+UnboxedNumbers+Guesses+DirectCalls+BuiltinCalls
// # FORM-LABEL: code f2:Body
// # FORM: [[step]]: {{*}} = StepGenerator
// # FORM: [[status]]: {{*}} = ResultAt [[step]] index=1
// # FORM: [[isNotStepped]]: {{*}} = StrictEq [[status]],
// # FORM: Branch [[isNotStepped]] -> taken [[notStepped]](), notTaken
// # FORM: [[notStepped]]() frequency=Rare
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function* count(n: number) { for (let i = 0; i < n; i++) yield i + 1; }
function each(things: Generator<number>) { let sum = 0; for (const thing of things) sum += thing; return sum; }
function ended() { const things = count(2); return each(things) + ":" + each(things); }
function* stepsItself(holder: { things: Generator<number> | null }): Generator<number> { yield 1; yield each(holder.things!); }
function running() { const holder: { things: Generator<number> | null } = { things: null }; holder.things = stepsItself(holder); try { return each(holder.things); } catch (e) { return (e as Error).name; } }
function closed() { const things = count(5); things.return(undefined); return each(things); }
report(each(count(3)));
report(each(count(0)));
report(ended());
report(running());
report(closed());
report(each(count(4)));
report("end");
