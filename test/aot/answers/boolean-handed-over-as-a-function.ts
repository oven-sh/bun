// answers: with-library
// # Boolean comes out of a list at a place that nobody has seen and is called by value: the stub in front of the host frame answers; String, Number, Object and Symbol go on to their functions
// # f1 = asked: the callee is one of several here, so the call goes by value. What the stub does with it: native test stubs/boxed-calls-of-language/boolean-called-by-value-takes-no-frame
// # RUN(FORM): bytes f1:Body mechanisms=all
// # FORM: Stub CallValue
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 48 of 48 of 48
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let calls = 0;
const order = JSON.parse("[4, 2, 0, 1, 3]");
const functions: any[] = [Number, Object, String, Symbol, Boolean];
const found: any[] = [];
for (let i = 0; i < order.length; i++) found[i] = functions[order[i]];
function asked(test: any, value: any) { const answer = test(value); calls++; return answer; }
function askedNothing(test: any) { const answer = test(); calls++; return answer; }
function askedMore(test: any, value: any, index: any, list: any) { const answer = test(value, index, list); calls++; return answer; }
function askedOn(holder: any, value: any) { const answer = holder.test(value); calls++; return answer; }
function kept(list: any[], test: any) { return list.filter(test).join("|"); }
function tried(f: () => unknown) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "another error"; } }
const truth = found[0];
report(asked(truth, true));
report(asked(truth, false));
report(asked(truth, undefined));
report(asked(truth, null));
report(asked(truth, 0));
report(asked(truth, -0));
report(asked(truth, 1));
report(asked(truth, -1));
report(asked(truth, 0.5));
report(asked(truth, NaN));
report(asked(truth, Infinity));
report(asked(truth, 2 ** 31));
report(asked(truth, ""));
report(asked(truth, "0"));
report(asked(truth, "false"));
let rope = "";
rope += String(calls);
rope += "x";
report(asked(truth, rope));
report(asked(truth, {}));
report(asked(truth, []));
report(asked(truth, () => 0));
report(asked(truth, new truth(false)));
report(asked(truth, Symbol("a")));
report(asked(truth, 0n));
report(asked(truth, 1n));
report(asked(truth, { valueOf() { calls += 100; return false; }, toString() { calls += 100; return ""; } }));
report(askedNothing(truth));
report(askedMore(truth, 0, 1, [1]));
report(askedMore(truth, "a", 0, []));
report(askedOn({ test: truth }, 0));
report(askedOn({ test: truth }, "a"));
report(asked(found[1], 12));
report(asked(found[1], null));
report(askedNothing(found[1]));
report(asked(found[2], "12"));
report(asked(found[2], true));
report(askedNothing(found[2]));
report(typeof asked(found[3], 1));
report(typeof asked(found[4], "made"));
report(asked((value: unknown) => value === 0, 0));
report(typeof new truth(0));
report(tried(() => asked(undefined, 1)));
report(kept([0, 1, "", "a", null, undefined, NaN, 0.5, false, true, -0, 2], truth));
report(kept([[], {}, 0n, 1n].map(value => typeof value), truth));
report([0, 1, 2].map(truth).join("|"));
report([0, "", null].some(truth));
report([1, "a", {}].every(truth));
report([0, "", 3, null].find(truth));
report(calls);
report("end");
