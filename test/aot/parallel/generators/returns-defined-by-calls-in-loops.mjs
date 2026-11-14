// A loop over a generator is left early. A call in its body has run code that defined a return for the generator, and that return resumes the generator.
const pick = name => process.argv.length < 0 ? "" : name;
const notes = [];
const { return: returns, next } = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
let turn = 0, finished = 0;
const override = function (value) { notes.push(JSON.stringify(next.call(this, 1)), finished); return returns.call(this, value); };
const define = function (generators) { if (turn === 1) generators.prototype[pick("return")] = override; };
function* itemsOfString(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const text = { toString() { define(itemsOfString); return "t"; } };
function leaveString() { let all = ""; for (const v of itemsOfString(4)) { all += String(text); if (turn++ > 0) break; } return all; }
function* itemsOfNumber(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const number = { valueOf() { define(itemsOfNumber); return 1; } };
function leaveNumber() { let all = ""; for (const v of itemsOfNumber(4)) { all += Number(number); if (turn++ > 0) return all + "!"; } return all; }
function* itemsOfMaximum(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const operand = { valueOf() { define(itemsOfMaximum); return 2; } };
function leaveMaximum() { let all = ""; for (const v of itemsOfMaximum(4)) { all += Math.max(operand, 0); if (turn++ > 0) break; } return all; }
function* itemsOfNaNTest(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const tested = { valueOf() { define(itemsOfNaNTest); return 3; } };
function leaveNaNTest() { let all = ""; for (const v of itemsOfNaNTest(4)) { all += isNaN(tested); if (turn++ > 0) throw new RangeError(all); } return all; }
function* itemsOfGetter(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const source = { get x() { define(itemsOfGetter); return 4; } };
function readX(object) { return object.x; }
function leaveGetter() { let all = ""; for (const v of itemsOfGetter(4)) { all += readX(source); if (turn++ > 0) break; } return all; }
function* itemsOfSetter(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const target = { set y(value) { define(itemsOfSetter); } };
function writeY(object, value) { object.y = value; }
function leaveSetter() { let all = ""; for (const v of itemsOfSetter(4)) { writeY(target, v); if (turn++ > 0) break; } return all; }
function* itemsOfPattern(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const pattern = { get z() { define(itemsOfPattern); return 5; } };
function pullZ({ z }) { return z; }
function leavePattern() { let all = ""; for (const v of itemsOfPattern(4)) { all += pullZ(pattern); if (turn++ > 0) break; } return all; }
function* itemsOfOperator(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const added = { valueOf() { define(itemsOfOperator); return 6; } };
function addOne(value) { return value + 1; }
function leaveOperator() { let all = ""; outer: for (let w = 0; w < 2; w++) { turn = 0; for (const v of itemsOfOperator(4)) { all += addOne(added); if (turn++ > 0) continue outer; } } return all; }
function* itemsOfProxy(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const proxy = new Proxy({}, { get() { define(itemsOfProxy); return 7; } });
function readW(object) { return object.w; }
function leaveProxy() { let all = ""; for (const v of itemsOfProxy(4)) { all += readW(proxy); if (turn++ > 0) break; } return all; }
function* itemsOfIterator(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const iterable = { [Symbol.iterator]() { define(itemsOfIterator); return [8][Symbol.iterator](); } };
function spread(values) { return [...values].length; }
function leaveIterator() { let all = ""; for (const v of itemsOfIterator(4)) { all += spread(iterable); if (turn++ > 0) break; } return all; }
function* itemsOfNested(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const inner = { get u() { define(itemsOfNested); return 9; } };
function readU(object) { return object.u; }
function readTwice(object) { return readU(object) + 1; }
function leaveNested() { let all = ""; for (const v of itemsOfNested(4)) { all += readTwice(inner); if (turn++ > 0) break; } return all; }
class Source { *items(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } } }
const source0 = new Source();
const textOfMethod = { toString() { define(Source.prototype.items); return "m"; } };
function leaveMethod() { let all = ""; for (const v of source0.items(4)) { all += String(textOfMethod); if (turn++ > 0) break; } return all; }
function* itemsPassed(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
const textOfPassed = { toString() { define(itemsPassed); return "p"; } };
function drain(items) { let all = ""; for (const v of items) { all += String(textOfPassed); if (turn++ > 0) break; } return all; }
function leavePassed() { return drain(itemsPassed(4)); }
console.log(itemsOfString(1).next().value, itemsOfNumber(1).next().value, itemsOfMaximum(1).next().value, itemsOfNaNTest(1).next().value, itemsOfGetter(1).next().value, itemsOfSetter(1).next().value, itemsOfPattern(1).next().value, itemsOfOperator(1).next().value, itemsOfProxy(1).next().value, itemsOfIterator(1).next().value, itemsOfNested(1).next().value, source0.items(1).next().value, itemsPassed(1).next().value);
for (const run of [leaveString, leaveNumber, leaveMaximum, leaveNaNTest, leaveGetter, leaveSetter, leavePattern, leaveOperator, leaveProxy, leaveIterator, leaveNested, leaveMethod, leavePassed]) {
  for (let again = 0; again < 2; again++) {
    let answer;
    turn = 0;
    try { answer = run(); } catch (error) { answer = error.name + " " + error.message; }
    console.log(run.name, answer, finished, notes.splice(0).join());
  }
}
