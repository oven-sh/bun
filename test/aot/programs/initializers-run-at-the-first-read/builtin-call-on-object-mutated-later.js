const log = [];

const added = { a: 1, b: 2 };
const keysOfAdded = Object.keys(added);
added.c = 3;

const stored = { a: 1, b: 2 };
const valuesOfStored = Object.values(stored);
stored.a = 9;

const deleted = { a: 1, b: 2 };
const entriesOfDeleted = Object.entries(deleted);
delete deleted.a;

const redefined = { a: 1 };
const valuesOfRedefined = Object.values(redefined);
Object.defineProperty(redefined, "a", { get() { log.push("getter of redefined"); return "from the getter"; }, enumerable: true });

const gainsAccessor = { a: 1 };
const valuesOfGainsAccessor = Object.values(gainsAccessor);
Object.defineProperty(gainsAccessor, "z", { get() { log.push("getter of z"); return "z"; }, enumerable: true });

const printed = { a: 1, inner: { b: 2 } };
const textOfPrinted = JSON.stringify(printed);
printed.inner.b = 3;

const copied = { a: 1 };
const copyOfCopied = Object.assign({}, copied);
copied.a = 2;

const spread = { a: 1 };
const spreadOfSpread = { ...spread, z: 1 };
spread.a = 2;

const changedByCall = { a: 1 };
function changeIt() { changedByCall.a = 5; }
const valuesOfChangedByCall = Object.values(changedByCall);
changeIt();

const changedLater = { a: 1 };
const valuesOfChangedLater = Object.values(changedLater);
function changeLater() { changedLater.a = 7; }

let calls = 0;
const withGetter = { get a() { calls++; log.push("getter of a"); return calls; } };
const valuesOfWithGetter = Object.values(withGetter);
log.push("behind the getter");

const frozen = Object.freeze({ a: 1 });
const keysOfFrozen = Object.keys(frozen);

const below = { a: 1 };
Object.setPrototypeOf(below, { get b() { log.push("getter above"); return 2; } });
const keysOfBelow = Object.keys(below);
const hasB = "b" in below;

const byKey = { a: 1 };
const keysOfByKey = Object.keys(byKey);
byKey[["n", "ew"].join("")] = 2;

const handedOut = { a: 1 };
const keysOfHandedOut = Object.keys(handedOut);
globalThis.handedOut = handedOut;
globalThis.handedOut.late = 1;

const left = { a: 1, b: 2, c: 3 };
const keysOfLeft = Object.keys(left);
const valuesOfLeft = Object.values(left);

function report() {
  return [
    keysOfAdded.join(), valuesOfStored.join(), JSON.stringify(entriesOfDeleted), valuesOfRedefined.join(), valuesOfGainsAccessor.join(), textOfPrinted, JSON.stringify(copyOfCopied),
    JSON.stringify(spreadOfSpread), valuesOfChangedByCall.join(), valuesOfChangedLater.join(), valuesOfWithGetter.join(), keysOfFrozen.join(), keysOfBelow.join(), hasB, keysOfByKey.join(),
    keysOfHandedOut.join(), keysOfLeft.join(), valuesOfLeft.join(),
  ].join(" | ");
}
changeLater();
log.push("before the first read");
console.log(report());
console.log(report());
console.log(log.join(" | "), calls);
