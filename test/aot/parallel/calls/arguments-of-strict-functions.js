"use strict";
var report = globalThis.report || console.log;
function writeParameter(a, b) { a = 10; return arguments[0] + "," + arguments[1] + "," + arguments.length; }
function writeElement(a, b) { arguments[0] = 20; arguments[1] = 30; return a + "," + b + "," + arguments[0] + "," + arguments[1] + "," + arguments.length; }
function fewer(a, b, c) { return arguments.length + "," + String(arguments[1]) + "," + String(arguments[2]) + "," + (1 in arguments) + "," + (0 in arguments); }
function more(a) { return arguments.length + "," + arguments[0] + "," + arguments[1] + "," + arguments[3]; }
function lengthOnly(a, b) { return arguments.length; }
function lengthOverwritten(a, b) { arguments.length = 1; return arguments.length + "," + arguments[1] + "," + Array.prototype.slice.call(arguments).length; }
function lengthOverwrittenInBranch(a, flag) { if (flag) arguments.length = 7; return arguments.length; }
function lengthDeleted(a) { delete arguments.length; return String(arguments.length); }
function calleeThrows() { try { return arguments.callee; } catch (error) { return error instanceof TypeError; } }
function leakedToClosure(a) { const all = arguments; const read = () => all[0] + all.length; all[0] = 5; return read(); }
function returned(a, b) { return arguments; }
function changedByCallee(a) { change(arguments); return a + "," + arguments[0] + "," + arguments.length; }
function change(list) { list[0] = 13; list.length = 9; }
function withDefault(a = 4, b) { return arguments.length + "," + String(arguments[0]) + "," + a; }
function withDefaultWritten(a = 4) { a = 6; return String(arguments[0]) + "," + a; }
function withRest(a, ...others) { return arguments.length + "," + arguments[0] + "," + String(arguments[2]) + "," + others.length; }
function withRestChanged(a, ...others) { others[0] = 99; others.push(1); return arguments.length + "," + String(arguments[1]) + "," + others.length; }
function withRestElementChanged(a, ...others) { arguments[1] = 98; return String(others[0]) + "," + arguments[1]; }
function withPattern({ x }, [y]) { return arguments.length + "," + arguments[0].x + "," + arguments[1][0] + "," + x + "," + y; }
function variableIndex(a, b, c) { let s = ""; for (let i = -1; i <= arguments.length; i++) s += String(arguments[i]) + "|"; return s; }
function downward() { let s = ""; for (let i = arguments.length - 1; i >= 0; i--) s += arguments[i] + "|"; return s; }
function indexOutside(a) { return String(arguments[-1]) + "," + String(arguments[1.5]) + "," + String(arguments["x"]) + "," + String(arguments[4294967295]) + "," + String(arguments[100]) + "," + String(arguments[NaN]) + "," + String(arguments[-0]); }
function byText(a, b) { return arguments["1"] + "," + arguments["length"] + "," + ("0" in arguments) + "," + (2 in arguments); }
function byObjectKey(a) { let calls = 0; const key = { toString() { calls++; return "0"; } }; return arguments[key] + "," + calls; }
function keys(a, b) { return Object.keys(arguments).join("|") + ";" + Object.getOwnPropertyNames(arguments).join("|") + ";" + Object.getOwnPropertySymbols(arguments).length; }
function tag() { return Object.prototype.toString.call(arguments) + "," + (typeof arguments) + "," + Array.isArray(arguments) + "," + JSON.stringify(arguments); }
function iterated() { let s = ""; for (const value of arguments) s += value + "|"; return s; }
function spreadOn() { return Math.max(...arguments) + "," + [...arguments, 0].length; }
function applied() { return Math.max.apply(null, arguments) + "," + sum.apply(this, arguments); }
function sum() { let t = 0; for (let i = 0; i < arguments.length; i++) t += arguments[i]; return t; }
function sliced() { return Array.prototype.slice.call(arguments, 1).join("|") + ";" + Array.from(arguments).join("|"); }
function holes() { delete arguments[1]; return arguments.length + "," + String(arguments[1]) + "," + (1 in arguments) + "," + Array.prototype.slice.call(arguments).length; }
function frozen(a) { Object.freeze(arguments); try { arguments[0] = 2; } catch (error) { return "threw," + arguments[0]; } return "stored"; }
function accessor(a) { Object.defineProperty(arguments, "0", { get() { return 15; } }); return arguments[0] + "," + a; }
function identity() { const all = arguments; return all === arguments; }
function two(a) { return inner(arguments, arguments); }
function inner(x, y) { return (x === y) + "," + arguments.length + "," + (arguments[0] === x); }
function inArrow(a) { const f = () => arguments[0] + arguments.length; return f(1, 2, 3); }
function nested() { function innerFunction() { return arguments.length; } return innerFunction(1) + "," + arguments.length; }
function thrown() { try { throw arguments; } catch (all) { return all.length; } }
function inTry(a) { try { fail(); } catch (error) { return arguments.length + "," + arguments[0]; } }
function fail() { throw new Error("x"); }
function* generator() { yield arguments.length; yield arguments[0]; }
async function asyncFunction(a) { await null; return arguments.length + "," + arguments[1]; }
class Counter { constructor() { this.count = arguments.length; this.first = arguments[0]; } method() { return arguments.length; } static make() { return new Counter(...arguments); } }
report(writeParameter(1, 2)); report(writeParameter(1)); report(writeParameter());
report(writeElement(1, 2)); report(writeElement(1)); report(writeElement());
report(fewer(1)); report(fewer(1, undefined)); report(fewer()); report(more(1, 2, 3, 4)); report(more(1));
report(lengthOnly()); report(lengthOnly(1)); report(lengthOnly(1, 2, 3)); report(lengthOnly(undefined, undefined));
report(lengthOverwritten(1, 2)); report(lengthOverwrittenInBranch(1, true)); report(lengthOverwrittenInBranch(1, false)); report(lengthDeleted(1)); report(calleeThrows());
report(leakedToClosure(1, 2)); const kept = returned(1, 2, 3); report(kept.length + "," + kept[0] + "," + kept[2]);
report(changedByCallee(1)); report(withDefault()); report(withDefault(undefined, 2)); report(withDefault(1)); report(withDefaultWritten()); report(withDefaultWritten(1));
report(withRest(1)); report(withRest(1, 2, 3)); report(withRestChanged(1, 2)); report(withRestChanged(1)); report(withRestElementChanged(1, 2)); report(withPattern({ x: 1 }, [2]));
report(variableIndex(1, 2)); report(variableIndex(1, 2, 3, 4)); report(variableIndex()); report(downward(1, 2, 3)); report(downward());
report(indexOutside(1)); report(byText(1, 2)); report(byObjectKey(1)); report(keys(1, 2, 3)); report(keys()); report(tag(1, "a"));
report(iterated(1, 2, 3)); report(iterated()); report(spreadOn(1, 5, 3)); report(spreadOn()); report(applied(1, 5, 3)); report(applied()); report(sliced(1, 2, 3)); report(sliced());
report(holes(1, 2, 3)); report(frozen(1)); report(accessor(1)); report(identity()); report(two(1)); report(inArrow(1, 2)); report(nested(1, 2)); report(thrown(1, 2)); report(inTry(1, 2));
const g = generator(7, 8); report(g.next().value + "," + g.next().value);
report(new Counter(1, 2).count + "," + new Counter().count + "," + String(new Counter().first) + "," + new Counter().method(1, 2, 3) + "," + Counter.make(4, 5, 6).count);
for (let turn = 0; turn < 3; turn++) { report(sum(turn, 1, 2) + ";" + lengthOnly(turn) + ";" + variableIndex(turn) + ";" + sliced(turn, 1)); }
asyncFunction(1, 2).then(value => { report(value); report("end"); });
