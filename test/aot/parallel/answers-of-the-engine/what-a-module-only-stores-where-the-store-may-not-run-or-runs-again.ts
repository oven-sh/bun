// What the body of a module makes out of the text alone and only stores in a variable is made at the first read of the variable.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function tell(read: () => unknown) { try { return String(read()); } catch (e: any) { return e.name; } }
function no() { return false; }
function yes() { return true; }
function fail(): void { throw new Error("stop"); }
function readSkipped() { return skipped; }
function readTaken() { return taken; }
function readBehind() { return behind; }
function readTurned() { return turned; }
function readNoTurn() { return noTurn; }
function readAssigned() { return assigned; }
function readShared() { return shared; }
function readAlias() { return alias; }
function inLoop() { let n = 0; for (let i = 0; i < 4; i++) { if (i > 1) n += counted.length; } return n; }
function inCatch() { try { fail(); return "none"; } catch { return caught.source; } }
function inFinally() { let text = ""; try { fail(); } catch { text = "c"; } finally { text += last.source; } return text; }
function twice() { const first = both; const second = both; return first === second; }
function acrossCall() { const first = crossed; touch(); return first === crossed; }
function touch() { return crossed.flags; }
function unused() { ignored; return 1; }
if (no()) { var skipped = /s/; }
if (yes()) { var taken = /t/; }
try { fail(); var behind = /b/; } catch { }
const seen: unknown[] = [];
for (let i = 0; i < 3; i++) { var turned = /u/; seen.push(readTurned()); }
for (let i = 0; i < 0; i++) { var noTurn = /n/; }
let assigned = /first/;
const kept = readAssigned();
assigned = /second/;
const shared = /h/;
const alias = shared;
const counted = [1, 2, 3];
const caught = /in-catch/;
const last = /in-finally/;
const both = { b: 1 };
const crossed = /x/gi;
const ignored = /i/;
report(tell(readSkipped));
report(tell(readTaken)); // @ts-expect-error
report(readTaken() === taken);
report(tell(readBehind));
report(seen[0] === seen[1]);
report(seen[1] === seen[2]);
report(seen[2] === readTurned());
report(tell(readNoTurn));
report(tell(readAssigned));
report(kept === readAssigned());
report(String(kept));
report(readShared() === readAlias());
report(inLoop());
report(inLoop());
report(inCatch());
report(inFinally());
report(twice());
report(acrossCall());
report(unused());
report("end");
