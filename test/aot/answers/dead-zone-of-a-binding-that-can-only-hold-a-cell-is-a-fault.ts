// answers: without-library
// # A binding read in its dead zone holds the word zero, and nothing is mapped there. Where whatever else it can hold is a cell (an object, a function, a text), the check reads the type of that cell: a load that faults, with no test, no branch and no late path.
// # Where it may hold a number too, and under a handler of the same function (a load ends no block), the word is tested as before. The error is the same one everywhere.
// # f1 = readObject, f2 = readText, f3 = readNumber, f4 = readMix, f5 = underHandler
// # RUN(FORM): bytes f1:Body f2:Body f3:Body f4:Body f5:Body mechanisms=all
// # FORM-LABEL: unit f1:Body
// # FORM: faults=1
// # FORM: fault {{*}}(ShownString "anObject")
// # FORM-LABEL: unit f2:Body
// # FORM: faults=1
// # FORM: fault {{*}}(ShownString "aText")
// # FORM-LABEL: unit f3:Body
// # FORM: faults=0
// # FORM: ThrowAtSite
// # FORM-LABEL: unit f4:Body
// # FORM: faults=0
// # FORM: ThrowAtSite
// # FORM-LABEL: unit f5:Body
// # FORM: faults=0
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function readObject() { return anObject; }
function readText() { return aText; }
function readNumber() { return aNumber; }
function readMix() { return aMix; }
function underHandler() { try { return anObject.field; } catch (e) { return "inside: " + (e as Error).name; } }
function tell(f: () => unknown) { try { const answer = f(); report(typeof answer + " " + (typeof answer === "object" ? JSON.stringify(answer) : String(answer))); } catch (e) { report((e as Error).name + ": " + (e as Error).message); } }
function askAll() { tell(readObject); tell(readText); tell(readNumber); tell(readMix); tell(underHandler); }
askAll();
const anObject = { field: 7 };
const aText = ["te", "xt"].join("");
const aNumber = aText.length;
const aMix = String(report).length > 3 ? { a: 1 } : 5;
askAll();
report("end");
