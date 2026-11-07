// A rest parameter that is only indexed, measured, iterated or spread on, one with no element, one that is written to, grown, returned, leaked to a closure and handed to built-ins.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function count(...all) { return all.length; }
function first(...all) { return String(all[0]); }
function sum(...values) { let s = 0; for (let i = 0; i < values.length; i++) s += values[i]; return s; }
function sumOf(...values) { let s = 0; for (const value of values) s += value; return s; }
function downward(...values) { let s = ""; for (let i = values.length - 1; i >= 0; i--) s += values[i] + "|"; return s; }
function behind(a, b, ...others) { return a + "," + String(b) + "," + others.length + "," + String(others[0]); }
function outside(...all) { return String(all[-1]) + "," + String(all[all.length]) + "," + String(all[1.5]) + "," + String(all["x"]) + "," + String(all[100]); }
function forwarded(...all) { return sum(...all); }
function forwardedWithMore(...all) { return sum(1, ...all, 2); }
function forwardedTwice(...all) { return sum(...all, ...all); }
function applied(...all) { return sum.apply(null, all); }
function toMax(...all) { return Math.max(...all); }
function returned(...all) { return all; }
function stored(...all) { holder.list = all; return all.length; }
const holder = { list: null };
function captured(...all) { return () => all.length + all[0]; }
function written(...all) { all[0] = 9; all[5] = 1; return all.length + "," + all[0] + "," + String(all[3]) + "," + (3 in all); }
function pushed(...all) { all.push(7); return all.length + "," + all[all.length - 1]; }
function popped(...all) { const last = all.pop(); return String(last) + "," + all.length; }
function shortened(...all) { all.length = 1; return all.length + "," + String(all[1]); }
function isList(...all) { return Array.isArray(all) + "," + (all instanceof Array) + "," + (Object.getPrototypeOf(all) === Array.prototype) + "," + Object.prototype.toString.call(all); }
function separate(...all) { return all; }
function mapped(...all) { return all.map(value => value * 2).join("|"); }
function destructured(...[a, b = 5, ...others]) { return String(a) + "," + b + "," + others.length; }
function namedProperty(...all) { all.extra = 3; return all.extra + "," + all.length + "," + Object.keys(all).join("|"); }
function changedByCallee(...all) { change(all); return all.length + "," + all[0]; }
function change(list) { list[0] = 13; list.push(1); }
function comparedWithItself(...all) { const other = all; return other === all; }
function holesKept(...all) { return all.length + "," + (0 in all) + "," + String(all[0]); }
function frozen(...all) { Object.freeze(all); try { "use strict"; all[0] = 1; } catch (error) { return "threw"; } return String(all[0]); }
function inLoopIndexPastEnd(...all) { let s = ""; for (let i = 0; i < 4; i++) s += String(all[i]) + "|"; return s; }
function joined(...all) { return all.join("-") + ";" + String(all) + ";" + JSON.stringify(all); }
function typeOfElements(...all) { let s = ""; for (const value of all) s += typeof value + "|"; return s; }
function early(...values) { for (const value of values) if (value > 2) return true; return false; }
function* generator(...all) { yield all.length; yield* all; }
async function asyncFunction(...all) { await null; return all.length + "," + all[1]; }
const arrow = (...all) => all.length + "," + String(all[0]);
report(count()); report(count(1)); report(count(1, 2, 3)); report(count(undefined)); report(count(...[])); report(count(...[1, 2], ...[3]));
report(first()); report(first(1)); report(sum()); report(sum(1, 2, 3)); report(sumOf()); report(sumOf(1, 2, 3)); report(downward()); report(downward(1, 2, 3));
report(behind(1)); report(behind(1, 2)); report(behind(1, 2, 3)); report(behind(1, 2, 3, 4)); report(outside()); report(outside(1, 2));
report(forwarded()); report(forwarded(1, 2, 3)); report(forwardedWithMore()); report(forwardedWithMore(1, 2)); report(forwardedTwice(1, 2)); report(applied()); report(applied(1, 2, 3)); report(toMax()); report(toMax(1, 7, 3));
const list = returned(1, 2); report(list.length + "," + list[1]); report(stored(1, 2, 3) + "," + holder.list[2]); report(captured(4, 5)());
report(written(1, 2)); report(written()); report(pushed()); report(pushed(1)); report(popped()); report(popped(1, 2)); report(shortened(1, 2, 3)); report(isList());
report(separate(1) === separate(1)); report(mapped(1, 2, 3)); report(mapped()); report(destructured()); report(destructured(1, 2, 3, 4)); report(namedProperty(1)); report(changedByCallee(1)); report(changedByCallee());
report(comparedWithItself()); report(holesKept(undefined)); report(holesKept(...[, 1])); report(frozen(5)); report(inLoopIndexPastEnd(1, 2)); report(joined(1, "a", null)); report(joined()); report(typeOfElements(1, "a", null, undefined, {}, () => 1));
report(early(1, 2, 3)); report(early(1, 2)); report(early());
const g = generator(7, 8); report(g.next().value + "," + g.next().value + "," + g.next().value + "," + g.next().done);
report(arrow()); report(arrow(1, 2));
const many = []; for (let i = 0; i < 300; i++) many.push(i); report(count(...many) + "," + sum(...many) + "," + forwarded(...many) + "," + applied(...many) + "," + toMax(...many));
for (let turn = 0; turn < 3; turn++) { report(sum(turn, 1, 2) + ";" + count(turn) + ";" + forwarded(turn, turn) + ";" + behind(turn)); }
report(await asyncFunction(1, 2));
report("end");
