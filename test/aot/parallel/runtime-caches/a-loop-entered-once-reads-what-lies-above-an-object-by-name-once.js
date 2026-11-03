// A long loop that a program enters once reads one name off one object that has no layout of its own. Its first turn reads by name; the answer for all the other turns comes
// ahead of the second turn, so the loop has no more use for a read by name. What lies above the object can change between two entries, so each entry must see it as it is now.
// Env: JSC_aotCountsPath=/dev/null
const counts = typeof aotOperationCount === "function";   // Only the jsc shell can count. Elsewhere the program checks the answers alone.
function readsByName() { return counts ? aotOperationCount("operationAOTGetByIdAndCache") + aotOperationCount("operationAOTFillSiteCache") : 0; }
function questions() { return counts ? aotOperationCount("operationAOTReadValueAndFillSiteCache") : 0; }

function inherited(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.up; return sum; }
function own(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.up; return sum; }
function missing(object, turns) { let count = 0; for (let i = 0; i < turns; i++) if (object.up === undefined) count++; return count; }
function throughGetter(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.up; return sum; }
function behindProxy(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.up; return sum; }
function twoLevels(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.up; return sum; }
function again(object, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += object.up; return sum; }

function once(label, run, isAsked = true) {
  const before = readsByName();
  const asked = questions();
  const answer = run();
  const reads = readsByName() - before;
  if (counts && reads > 1) throw new Error(label + ": " + reads + " reads by name, one was enough");
  if (counts && isAsked && questions() === asked) throw new Error(label + ": nothing was asked ahead of the loop");
  console.log(label + ":", answer);
}

const turns = JSON.parse("1000");
once("inherited value", () => inherited(Object.create({ up: 2 }), turns));
once("own value", () => own(JSON.parse('{"up":3}'), turns), false);
once("nothing there", () => missing(Object.create({ other: 1 }), turns));
once("two levels up", () => twoLevels(Object.create(Object.create({ up: 5 })), turns));

let called = 0;
console.log("getter above runs in every turn:", throughGetter(Object.create({ get up() { return ++called; } }), 4), called);
console.log("proxy above:", behindProxy(Object.create(new Proxy({ up: 7 }, {})), 4));

const above = { up: 1 };
const below = Object.create(above);
console.log("first entry:", again(below, 4));
above.up = 10;
console.log("value above changed:", again(below, 4));
below.up = 100;
console.log("own value in front of it:", again(below, 4));
delete below.up;
console.log("own value gone:", again(below, 4));
Object.setPrototypeOf(below, { up: 1000 });
console.log("another object above:", again(below, 4));
Object.setPrototypeOf(below, { get up() { return 5; } });
console.log("a getter there now:", again(below, 4));
Object.setPrototypeOf(below, null);
console.log("nothing above:", again(below, 2));
console.log("string:", again("text", 2));
