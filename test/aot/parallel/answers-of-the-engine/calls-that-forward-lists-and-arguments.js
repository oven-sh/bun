// `f.call(..)`, `f.apply(..)`, `Reflect.apply(..)`, `f(...list)` and `Math.max(...list)`: with lists, `arguments`, array-likes, holes, getters, null and what is no list,
// with `call` and `apply` overwritten on the function, on Function.prototype's heirs and read off what is no function, in tail position, and with receivers of every kind.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function three(a, b, c) { return String(a) + "," + String(b) + "," + String(c) + "," + arguments.length; }
function withThis(a) { return String(this && this.name) + "," + String(a); }
function strictThis() { "use strict"; return String(this); }
function sum(...values) { let s = 0; for (let i = 0; i < values.length; i++) s += values[i]; return s; }
const receiver = { name: "r", method(a, b) { return this.name + a + b; } };
report(three.apply(null, [1, 2, 3])); report(three.apply(null, [1])); report(three.apply(null, [1, 2, 3, 4])); report(three.apply(null, [])); report(three.apply(null)); report(three.apply(null, null)); report(three.apply(null, undefined)); report(three.apply());
report(three.apply(null, { length: 2, 0: "x", 1: "y" })); report(three.apply(null, { length: 2 })); report(three.apply(null, "ab" === "ab" ? new String("ab") : null));
try { three.apply(null, 1); report("no error"); } catch (error) { report(error instanceof TypeError); }
try { three.apply(null, "ab"); report("no error"); } catch (error) { report(error instanceof TypeError); }
report(three.call(null, 1, 2, 3)); report(three.call(null)); report(three.call()); report(three.call(null, 1, 2, 3, 4));
report(withThis.call(receiver, 1)); report(withThis.apply(receiver, [2])); report(strictThis.call(5)); report(strictThis.call(null)); report(strictThis.call(undefined)); report(strictThis.apply("s", []));
report(receiver.method.call({ name: "o" }, 1, 2)); report(receiver.method.apply({ name: "p" }, [1, 2])); report(receiver.method(...[1, 2]));
report(three(...[1, 2, 3])); report(three(...[1], ...[2, 3])); report(three(0, ...[1, 2])); report(three(...[])); report(three(...[, 1])); report(three(..."ab")); report(three(...new Set([1, 2]))); report(three(...new Map([[1, 2]])));
const holey = [1, , 3]; report(three(...holey)); report(three.apply(null, holey));
try { three(...null); report("no error"); } catch (error) { report(error instanceof TypeError); }
try { three(...undefined); report("no error"); } catch (error) { report(error instanceof TypeError); }
try { three(...5); report("no error"); } catch (error) { report(error instanceof TypeError); }
report(Math.max(...[1, 5, 3])); report(Math.max(...[])); report(Math.max(...[1, "7", 3])); report(String(Math.max(...[1, undefined]))); report(Math.max.apply(null, [1, 5, 3])); report(Math.max.apply(Math, [])); report(Math.min(...[4, 2], 3)); report(Math.max.call(null, 1, 9));
let order = ""; const noisy = { valueOf() { order += "v"; return 4; } }; report(Math.max(...[noisy, noisy]) + order);
const changing = [1, 2, 3]; function changes(a, b, c) { changing[0] = 100; return a + b + c; } report(changes(...changing) + "," + changing[0]); report(changes.apply(null, changing) + "," + changing[0]);
function keepsList(...all) { return all; } const source = [1, 2]; const kept = keepsList(...source); kept[0] = 50; report(source[0] + "," + kept[0] + "," + (kept === source)); const keptByApply = keepsList.apply(null, source); keptByApply.push(1); report(source.length + "," + keptByApply.length + "," + (keptByApply === source));
const ownIterator = [1, 2, 3]; ownIterator[Symbol.iterator] = function* () { yield 7; yield 8; }; report(three(...ownIterator)); report(three.apply(null, ownIterator)); report(sum(...ownIterator)); report(Math.max(...ownIterator));
class List extends Array { *[Symbol.iterator]() { yield 9; } } const sub = List.from([1, 2]); report(three(...sub)); report(three.apply(null, sub)); report(sum(...sub));
const getterList = [1, 2]; Object.defineProperty(getterList, "1", { get() { return 77; } }); report(three(...getterList)); report(three.apply(null, getterList));
const bound = three.bind(null, 1); report(bound(...[2, 3])); report(bound.apply(null, [2])); report(bound.call(null, 2, 3, 4));
report(Reflect.apply(three, null, [1, 2])); report(Function.prototype.call.call(three, null, 1)); report(Function.prototype.apply.call(three, null, [1, 2])); report(Function.prototype.call.apply(three, [null, 1, 2]));
try { Function.prototype.call.call(1); report("no error"); } catch (error) { report(error instanceof TypeError); }
try { ({}).x.call(1); report("no error"); } catch (error) { report(error instanceof TypeError); }
function replacedCall() { return "own"; } replacedCall.call = function () { return "replaced"; }; replacedCall.apply = function () { return "replaced too"; }; report(replacedCall.call(null) + "," + replacedCall.apply(null, []));
report(new (class { constructor(...all) { this.n = all.length; } })(...[1, 2, 3]).n); report(new Date(...[2020, 0, 2]).getFullYear()); report(new Array(...[3]).length + "," + new Array(...[1, 2]).length);
const many = []; for (let i = 0; i < 70000; i++) many.push(1); try { report(sum(...many)); } catch (error) { report(error instanceof RangeError); } try { report(sum.apply(null, many)); } catch (error) { report(error instanceof RangeError); } try { report(Math.max(...many)); } catch (error) { report(error instanceof RangeError); }
for (let turn = 0; turn < 3; turn++) { const list = [turn, 1, 2]; report(sum.apply(null, list) + ";" + sum(...list) + ";" + Math.max(...list) + ";" + three.call(null, turn) + ";" + three(...list)); }
report("end");
