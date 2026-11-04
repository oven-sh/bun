// A variable of a CommonJS file holds undefined until the file stores into it, and whoever is called first finds that: `o[k]` is then `o["undefined"]`.
const report = value => console.log(typeof value === "string" ? JSON.stringify(value) : String(value));
function readEarly(o) { return o[early]; }
report(readEarly({ undefined: "under undefined" }));
var early = Symbol("early");
report(readEarly({ undefined: "under undefined", [early]: "under the symbol" }));
function callNow(f) { return f(); }
report(callNow(function () { return typeof passed; }));
var passed = Symbol("passed");
report(callNow(function () { return typeof passed; }));
var table = { read(o) { return o[viaTable]; } };
report(table.read({ undefined: 1 }));
var viaTable = Symbol("viaTable");
report(table.read({ undefined: 1, [viaTable]: 2 }));
var withGetter = { get now() { return typeof viaGetter; } };
report(withGetter.now);
var viaGetter = Symbol("viaGetter");
report(withGetter.now);
class Early { static seen = typeof viaStatic; static read() { return typeof viaStatic; } }
var viaStatic = Symbol("viaStatic");
report(Early.seen);
report(Early.read());
if (report.length > 5) { var conditional = Symbol("conditional"); }
function readConditional(o) { return o[conditional]; }
report(readConditional({ undefined: "none" }));
function fails() { throw new Error("fails"); }
try { fails(); var inTry = Symbol("inTry"); } catch {}
function readInTry(o) { return o[inTry]; }
report(readInTry({ undefined: "none" }));
var seenBefore = typeof readByBody;
var readByBody = Symbol("readByBody");
report(seenBefore);
function readReadByBody(o) { return o[readByBody]; }
report(readReadByBody({ [readByBody]: 3 }));
function inner(o) { return o[transitive]; }
function outer(o) { return inner(o); }
report(outer({ undefined: "early" }));
var transitive = Symbol("transitive");
report(outer({ undefined: "early", [transitive]: "late" }));
var held = function (o) { return o[viaHeld]; };
function callsHeld(o) { return held(o); }
report(callsHeld({ undefined: "early" }));
var viaHeld = Symbol("viaHeld");
report(callsHeld({ undefined: "early", [viaHeld]: "late" }));
var good = Symbol("good");
function readGood(o) { return o[good]; }
function storeGood(o, v) { o[good] = v; }
var target = { name: "target" };
storeGood(target, 5);
report(readGood(target));
report(Object.getOwnPropertySymbols(target)[0] === good);
report(readGood({ undefined: "never" }));
function* steps(o) { yield o[viaGenerator]; yield o[viaGenerator]; }
var stepped = { undefined: "early" };
var running = steps(stepped);
report(running.next().value);
var viaGenerator = Symbol("viaGenerator");
stepped[viaGenerator] = "late";
report(running.next().value);
var twice = Symbol("twice, first");
function readTwice(o) { return o[twice]; }
var both = { [twice]: "first" };
report(readTwice(both));
twice = Symbol("twice, second");
both[twice] = "second";
report(readTwice(both));
for (var turn = 0; turn < 2; turn++) { var looped = Symbol("looped"); }
function readLooped(o) { return o[looped]; }
report(readLooped({ [looped]: "last" }));
[1].forEach(function () { report(typeof viaCallback); });
var viaCallback = Symbol("viaCallback");
[1].forEach(function () { report(typeof viaCallback); });
switch (report.length) { case 99: var inSwitch = Symbol("inSwitch"); }
function readInSwitch(o) { return o[inSwitch]; }
report(readInSwitch({ undefined: "none" }));
function plusOne() { return number + 1; }
report(String(plusOne()));
var number = 41;
report(plusOne());
function readConstant() { return typeof constant; }
try { readConstant(); report("no error"); } catch (error) { report(error instanceof ReferenceError); }
const constant = Symbol("constant");
report(readConstant());
var bound = function (o) { return o[viaBound]; }.bind(null);
report(bound({ undefined: "early" }));
var viaBound = Symbol("viaBound");
report(bound({ undefined: "early", [viaBound]: "late" }));
var lazily = { valueOf() { return typeof viaConversion; } };
report(`${lazily + ""}`);
var viaConversion = Symbol("viaConversion");
report(`${lazily + ""}`);
var later = Promise.resolve().then(function () { return typeof viaJob; });
var viaJob = Symbol("viaJob");
later.then(function (answer) { report(answer); report("end"); });
