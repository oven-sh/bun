import { runInThisContext as loadString } from "node:vm";
const report = value => console.log(String(value));
const attempt = (way) => { try { return way(); } catch (error) { return error.name; } };
globalThis.shadowed = 20;
function readShadowed() { return shadowed; }
function readShadowedOffObject() { return globalThis.shadowed; }
function typeOfShadowed() { return typeof shadowed; }
function storeShadowed(value) { shadowed = value; }
function storeShadowedOnObject(value) { globalThis.shadowed = value; }
report(readShadowed());
report(readShadowed());
report(readShadowedOffObject());
report(typeOfShadowed());
loadString("let shadowed = 'of the script';");
report(readShadowed());
report(readShadowed());
report(readShadowedOffObject());
report(typeOfShadowed());
loadString("shadowed = 21;");
report(readShadowed());
report(readShadowedOffObject());
storeShadowed(22);
report(readShadowed());
report(readShadowedOffObject());
report(loadString("shadowed"));
storeShadowedOnObject(23);
report(readShadowed());
report(readShadowedOffObject());
function readAbsentThenLet() { return typeof appearsAsLet; }
report(readAbsentThenLet());
report(readAbsentThenLet());
loadString("let appearsAsLet = 24;");
report(readAbsentThenLet());
loadString("const fixed = 25;");
function readFixed() { return fixed; }
function storeFixed(value) { fixed = value; }
report(readFixed());
report(readFixed());
report(attempt(() => storeFixed(26)));
report(readFixed());
loadString("class DeclaredClass { static answer() { return 27; } }");
function readClass() { return DeclaredClass.answer(); }
report(readClass());
report(readClass());
report(attempt(() => loadString("missingFunction(); let dead = 28;")));
function readDead() { return dead; }
function typeOfDead() { return typeof dead; }
function storeDead(value) { dead = value; }
report(attempt(readDead));
report(attempt(typeOfDead));
report(attempt(() => storeDead(29)));
report(attempt(readDead));
const shadowsInLoop = () => { loadString("let looped = 5;"); };
globalThis.looped = 1;
function shadowedInLoop(turns) { let sum = 0; for (let turn = 0; turn < turns; turn++) { sum += looped; if (turn === 4) shadowsInLoop(); } return sum; }
report(shadowedInLoop(10));
report("end");
/* Output:
20
20
20
number
of the script
of the script
20
string
21
20
22
20
22
22
23
undefined
undefined
number
25
25
TypeError
25
27
27
ReferenceError
ReferenceError
ReferenceError
ReferenceError
ReferenceError
30
end
*/
