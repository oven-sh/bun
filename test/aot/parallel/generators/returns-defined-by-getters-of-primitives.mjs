// A loop over a generator is left early. A call in its body has read a property of a primitive, whose getter on the prototype defined a return for the generator. That return resumes the generator.
const pick = name => process.argv.length < 0 ? "" : name;
const notes = [];
const { return: returns, next } = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
let turn = 0, finished = 0, generators = null;
const override = function (value) { notes.push(JSON.stringify(next.call(this, 1)), finished); return returns.call(this, value); };
const define = () => { if (turn === 1) generators.prototype[pick("return")] = override; };
for (const { prototype } of [String, Number, BigInt, Symbol, Boolean]) Object.defineProperty(prototype, "raw", { get() { define(); return ["r"]; } });
function* itemsOfString(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
function leaveString() { let all = ""; generators = itemsOfString; for (const v of itemsOfString(4)) { all += String.raw("x"); if (turn++ > 0) break; } return all; }
function* itemsOfNumber(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
function leaveNumber() { let all = ""; generators = itemsOfNumber; for (const v of itemsOfNumber(4)) { all += String.raw(5); if (turn++ > 0) break; } return all; }
function* itemsOfBigInt(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
function leaveBigInt() { let all = ""; generators = itemsOfBigInt; for (const v of itemsOfBigInt(4)) { all += String.raw(7n); if (turn++ > 0) break; } return all; }
function* itemsOfBoolean(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
function leaveBoolean() { let all = ""; generators = itemsOfBoolean; for (const v of itemsOfBoolean(4)) { all += String.raw(true); if (turn++ > 0) break; } return all; }
function* itemsOfSymbol(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
function leaveSymbol() { let all = ""; generators = itemsOfSymbol; for (const v of itemsOfSymbol(4)) { all += String.raw(Symbol.iterator); if (turn++ > 0) break; } return all; }
function* itemsOfYielded(limit) { try { for (let i = 0; i < limit; i++) yield i; } finally { finished++; } }
function leaveYielded() { let all = ""; generators = itemsOfYielded; for (const v of itemsOfYielded(4)) { all += String.raw(v); if (turn++ > 0) break; } return all; }
console.log(itemsOfString(1).next().value, itemsOfNumber(1).next().value, itemsOfBigInt(1).next().value, itemsOfBoolean(1).next().value, itemsOfSymbol(1).next().value, itemsOfYielded(1).next().value);
for (const run of [leaveString, leaveNumber, leaveBigInt, leaveBoolean, leaveSymbol, leaveYielded]) {
  for (let again = 0; again < 2; again++) {
    let answer;
    turn = 0;
    try { answer = run(); } catch (error) { answer = error.name + " " + error.message; }
    console.log(run.name, answer, finished, notes.splice(0).join());
  }
}
