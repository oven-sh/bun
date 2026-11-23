// answers: with-library
// # A free name and a name of the global object go by a record that the first access files. Whoever stores, defines or deletes the name empties it: compiled code, evaluated text, Reflect, Object.assign, a script's `var` and `function`, in a loop and outside. A name that appears later, a getter, a setter, a property that is read-only for a while and two hundred new names beside it each answer as the language says.
// # At the end the shell runs the same text itself: every answer is the same.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 95 of 95 of 95
// # CHECK-NEXT: exited with 0
const attempt = (way) => { try { return way(); } catch (error) { return error.name; } };
function readLater() { return later; }
function typeOfLater() { return typeof later; }
function readLaterOffObject() { return globalThis.later; }
report(attempt(readLater));
report(typeOfLater());
report(readLaterOffObject());
report(attempt(readLater));
report(typeOfLater());
report(readLaterOffObject());
globalThis.later = 1;
report(readLater());
report(typeOfLater());
report(readLaterOffObject());
report(readLater());
(0, eval)("globalThis.later = 2");
report(readLater());
report(readLaterOffObject());
new Function("later = 3")();
report(readLater());
report(readLater());
Reflect.set(globalThis, "later", "text");
report(readLater());
report(typeOfLater());
Object.assign(globalThis, { later: 4 });
report(readLater());
delete globalThis.later;
report(attempt(readLater));
report(typeOfLater());
report(readLaterOffObject());
report(attempt(readLater));
globalThis.later = 5;
report(readLater());
report(typeOfLater());
(0, eval)("delete globalThis.later");
report(attempt(readLater));
report(typeOfLater());
let asked = 0;
globalThis.plain = 6;
function readPlain() { return plain; }
function readPlainOffObject() { return globalThis.plain; }
function typeOfPlain() { return typeof plain; }
report(readPlain());
report(readPlain());
report(readPlainOffObject());
Object.defineProperty(globalThis, "plain", { get() { asked++; return 7; }, configurable: true });
report(readPlain());
report(readPlain());
report(readPlainOffObject());
report(typeOfPlain());
report(asked);
Object.defineProperty(globalThis, "plain", { get() { throw new RangeError("asked"); }, configurable: true });
report(attempt(readPlain));
report(attempt(typeOfPlain));
Object.defineProperty(globalThis, "plain", { value: 8, writable: true, configurable: true });
report(readPlain());
report(readPlain());
(0, eval)("Object.defineProperty(globalThis, 'plain', { get() { return 9; }, configurable: true })");
report(readPlain());
let taken = "nothing";
Object.defineProperty(globalThis, "taking", { get() { return taken; }, set(value) { taken = "took " + value; }, configurable: true });
function storeTaking(value) { taking = value; }
function storeTakingOnObject(value) { globalThis.taking = value; }
function readTaking() { return taking; }
storeTaking(1);
report(readTaking());
storeTaking(2);
report(readTaking());
storeTakingOnObject(3);
report(readTaking());
Object.defineProperty(globalThis, "taking", { value: 10, writable: true, configurable: true });
storeTaking(11);
report(readTaking());
storeTaking(12);
report(readTaking());
report((0, eval)("taking"));
Object.defineProperty(globalThis, "taking", { set(value) { taken = "took again " + value; }, configurable: true });
storeTaking(13);
report(taken);
report(readTaking());
loadString("var declaredByVar = 14;");
function readVar() { return declaredByVar; }
function storeVar(value) { declaredByVar = value; }
report(readVar());
report(readVar());
loadString("declaredByVar = 15;");
report(readVar());
loadString("var declaredByVar = 16;");
report(readVar());
storeVar(17);
report(readVar());
report(loadString("declaredByVar"));
report(attempt(() => delete globalThis.declaredByVar));
report(readVar());
loadString("function declaredAsFunction() { return 18; }");
function callDeclared() { return declaredAsFunction(); }
report(callDeclared());
report(callDeclared());
loadString("function declaredAsFunction() { return 19; }");
report(callDeclared());
function storeMissing(value) { neverDeclared = value; }
function readMissing() { return neverDeclared; }
report(attempt(() => storeMissing(30)));
report(attempt(readMissing));
report(attempt(() => storeMissing(31)));
globalThis.neverDeclared = 32;
report(readMissing());
storeMissing(33);
report(readMissing());
report(globalThis.neverDeclared);
storeMissing(34);
report(readMissing());
report((0, eval)("neverDeclared"));
(0, eval)("neverDeclared = 35");
report(readMissing());
storeMissing(36);
report((0, eval)("neverDeclared"));
delete globalThis.neverDeclared;
report(attempt(() => storeMissing(37)));
report(attempt(readMissing));
Object.defineProperty(globalThis, "readOnly", { value: 38, writable: false, configurable: true });
function storeReadOnly(value) { readOnly = value; }
function readReadOnly() { return readOnly; }
report(readReadOnly());
report(attempt(() => storeReadOnly(39)));
report(readReadOnly());
Object.defineProperty(globalThis, "readOnly", { value: 40, writable: true, configurable: true });
report(readReadOnly());
storeReadOnly(41);
report(readReadOnly());
Object.defineProperty(globalThis, "readOnly", { writable: false });
report(attempt(() => storeReadOnly(42)));
report(readReadOnly());
globalThis.steady = 43;
function readSteady() { return steady; }
report(readSteady());
for (let index = 0; index < 200; index++) globalThis["filler" + index] = index;
report(readSteady());
globalThis.steady = 44;
report(readSteady());
for (let index = 0; index < 200; index++) delete globalThis["filler" + index];
report(readSteady());
globalThis.steady = 45;
report(readSteady());
globalThis.counter = 1;
function sumInLoop(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) sum += counter; return sum; }
report(sumInLoop(10));
globalThis.counter = 2;
report(sumInLoop(10));
const bump = () => { globalThis.counter = 100; };
function changesInLoop(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum += counter; if (turn === 4) bump(); } return sum; }
report(changesInLoop(10));
const bumpByText = new Function("counter = 1000");
function changesByTextInLoop(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum += counter; if (turn === 4) bumpByText(); } return sum; }
report(changesByTextInLoop(10));
function countUp(turns) { for (let turn = 0; turn < turns; turn++) counter = counter + 1; return counter; }
report(countUp(10));
report(globalThis.counter);
report((0, eval)("counter"));
const becomesGetter = () => { Object.defineProperty(globalThis, "counter", { get() { return 7; }, set() {}, configurable: true }); };
function definedInLoop(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum += counter; counter = 1; if (turn === 4) becomesGetter(); } return sum; }
report(definedInLoop(10));
const deletesInLoop = () => { delete globalThis.vanishing; };
globalThis.vanishing = 1;
function deletedInLoop(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum += typeof vanishing === "number" ? vanishing : 10; if (turn === 4) deletesInLoop(); } return sum; }
report(deletedInLoop(10));
globalThis[Symbol.for("registered")] = 46;
function readUnderSymbol() { return globalThis[Symbol.for("registered")]; }
report(readUnderSymbol());
globalThis[Symbol.for("registered")] = 47;
report(readUnderSymbol());
globalThis[0] = 48;
function readIndex() { return globalThis[0]; }
report(readIndex());
globalThis[0] = 49;
report(readIndex());
for (const name of ["later", "plain", "taking", "neverDeclared", "readOnly", "steady", "counter", "vanishing", Symbol.for("registered"), 0]) delete globalThis[name];
report("end");
