// A Set or a Map written as a literal of texts is asked for its size, then for a key, then for its size again, all in one function, at the first time that anybody touches it.
const word: string = String(process.argv[2] ?? "beta");
const piece: string = ("x" + word + "y").slice(1, 1 + word.length);
const absent: string = word + "?";
const lines: string[] = [];
function report(label: string, ...values: unknown[]): void { lines.push(label + " " + JSON.stringify(values)); }

const setForHas = new Set(["alpha", "beta", "gamma"]);
function sizeAroundHas(w: string): unknown[] { const before = setForHas.size; const found = setForHas.has(w); return [before, found, setForHas.size]; }
const mapForGet = new Map([["alpha", 1], ["beta", 2], ["gamma", 3], ["delta", 4]]);
function sizeAroundGet(w: string): unknown[] { const before = mapForGet.size; const found = mapForGet.get(w); return [before, found, mapForGet.size]; }
const mapForHas = new Map([["alpha", 1], ["beta", 2]]);
function sizeAroundMapHas(w: string): unknown[] { const before = mapForHas.size; const found = mapForHas.has(w); return [before, found, mapForHas.size]; }
const setForPiece = new Set(["alpha", "beta", "gamma", "delta", "epsilon"]);
function sizeAroundPiece(w: string): unknown[] { const before = setForPiece.size; const found = setForPiece.has(w); return [before, found, setForPiece.size]; }
const setForMiss = new Set(["alpha", "beta", "gamma"]);
function sizeAroundMiss(w: string): unknown[] { const before = setForMiss.size; const found = setForMiss.has(w); return [before, found, setForMiss.size]; }
const setInLoop = new Set(["alpha", "beta", "gamma"]);
function sizeInLoop(w: string): number { let total = 0; for (let turn = 0; turn < 1000; turn++) { total += setInLoop.size; if (turn === 500 && setInLoop.has(w)) total += 1_000_000; } return total; }
const mapTwice = new Map([["alpha", 1], ["beta", 2], ["gamma", 3]]);
function getTwice(w: string): unknown[] { return [mapTwice.get(w), mapTwice.get("alpha"), mapTwice.get(w), mapTwice.size]; }
const setWalked = new Set(["alpha", "beta", "gamma"]);
function lookupInsideWalk(w: string): unknown[] { const seen: string[] = []; for (const text of setWalked) { seen.push(text + (setWalked.has(w) ? "+" : "-") + setWalked.size); } return seen; }
const setWithIterator = new Set(["alpha", "beta", "gamma"]);
function lookupBetweenSteps(w: string): unknown[] { const steps = setWithIterator.values(); const first = steps.next().value; const found = setWithIterator.has(w); return [first, found, steps.next().value, steps.next().value, steps.next().done, setWithIterator.size]; }
const mapWritten = new Map([["alpha", 1], ["beta", 2]]);
function lookupThenStore(w: string): unknown[] { const before = mapWritten.size; const found = mapWritten.get(w); mapWritten.set("new", 9); return [before, found, mapWritten.size, mapWritten.get("new"), [...mapWritten.keys()].join()]; }
const setSpread = new Set(["alpha", "beta", "gamma"]);
function lookupThenSpread(w: string): unknown[] { const found = setSpread.has(w); return [found, [...setSpread].join(), setSpread.size]; }

for (const round of [1, 2]) {
  report("has " + round, sizeAroundHas(word));
  report("get " + round, sizeAroundGet(word));
  report("map has " + round, sizeAroundMapHas(word));
  report("a piece of another text " + round, sizeAroundPiece(piece));
  report("a miss " + round, sizeAroundMiss(absent));
  report("in a loop " + round, sizeInLoop(word));
  report("twice " + round, getTwice(word));
  report("inside a walk " + round, lookupInsideWalk(word));
  report("between the steps of an iterator " + round, lookupBetweenSteps(word));
  report("then a store " + round, lookupThenStore(word));
  report("then a spread " + round, lookupThenSpread(word));
}
console.log(lines.join("\n"));
