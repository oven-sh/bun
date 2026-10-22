// One walker is handed callbacks of many kinds. Most die with the call. Some keep themselves, what they capture, or a closure over their scope: those go on working when the frame that made them is long gone.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

interface N { kind: number; parent: N | undefined }
type Answer = boolean | "quit";
function findUp(node: N | undefined, callback: (element: N) => Answer): N | undefined {
  while (node) {
    const result = callback(node);
    if (result === "quit") return undefined;
    else if (result) return node;
    node = node.parent;
  }
  return undefined;
}
let leaf: N = { kind: 0, parent: undefined };
for (let i = 1; i <= 24; i++) leaf = { kind: i, parent: leaf };

// Overwrites what earlier frames have left on the stack.
function trample(depth: number, a: number, b: number, c: number): number {
  const d = a * 3 + depth, e = b * 5 + depth, f = c * 7 + depth, g = d ^ e, h = e ^ f, i = f ^ d;
  if (depth === 0) return d + e + f + g + h + i;
  return trample(depth - 1, g, h, i) + d - e + f - g + h - i;
}

const keptCallbacks: ((element: N) => Answer)[] = [];
const keptReaders: (() => number)[] = [];
const keptObjects: { count: number }[] = [];

function capturesNothing(node: N) {
  const found = findUp(node, n => n.kind === 3 || n.kind === 5);
  return found ? found.kind : -1;
}
function capturesANumber(node: N, kind: number) {
  const found = findUp(node, n => n.kind === kind);
  return found ? found.kind : -1;
}
function countsInItsScope(node: N) {
  let steps = 0;
  findUp(node, () => { steps++; return false; });
  return steps;
}
function quits(node: N, at: number) {
  let last = -1;
  const found = findUp(node, n => { last = n.kind; return n.kind === at ? "quit" : false; });
  return String(found) + " " + last;
}
function keepsItself(node: N) {
  const found = findUp(node, function visit(n) {
    if (n.kind === 20) keptCallbacks.push(visit);
    return n.kind === 18;
  });
  return found ? found.kind : -1;
}
function declarationKeepsItself(node: N, limit: number) {
  const found = findUp(node, visit);
  return found ? found.kind : -1;
  function visit(n: N): Answer {
    if (n.kind === limit + 1) keptCallbacks.push(visit);
    return n.kind === limit;
  }
}
function keepsAClosureOverItsScope(node: N, start: number) {
  let total = start;
  findUp(node, n => {
    total += n.kind;
    if (n.kind === 10) keptReaders.push(() => ++total);
    return false;
  });
  return total;
}
function keepsWhatItCaptures(node: N) {
  const box = { count: 0 };
  findUp(node, n => {
    box.count++;
    if (n.kind === 7) keptObjects.push(box);
    return false;
  });
  return box.count;
}
function walksAgainInside(node: N) {
  let pairs = 0;
  findUp(node, outer => {
    findUp(outer.parent, inner => { if (inner.kind * 2 === outer.kind) pairs++; return false; });
    return false;
  });
  return pairs;
}
function throwsFromInside(node: N) {
  let seen = 0;
  try {
    findUp(node, n => { seen++; if (n.kind === 12) throw new Error("at " + n.kind + " after " + seen); return false; });
    return "nothing";
  } catch (error) {
    return (error as Error).message + " " + seen;
  }
}
function handsOnItsOwnParameter(node: N, callback: (element: N) => Answer) {
  const found = findUp(node, callback);
  return found ? found.kind : -1;
}
function throughAnotherFunction(node: N, kind: number) {
  return handsOnItsOwnParameter(node, n => n.kind === kind);
}

// A walker that keeps its callback: whatever it is handed outlives the call.
const later: { node: N; callback: (element: N) => Answer }[] = [];
function findUpLater(node: N, callback: (element: N) => Answer) {
  later.push({ node, callback });
}
function isKeptByTheCallee(node: N, kind: number) {
  let calls = 0;
  findUpLater(node, n => { calls++; return n.kind === kind + calls - calls; });
  findUp(node, n => n.kind === kind);
  return calls;
}
// A walker that throws or returns its callback.
function returnsItsCallback(node: N, callback: (element: N) => Answer) {
  return callback(node) ? callback : undefined;
}
function throwsItsCallback(node: N, callback: (element: N) => Answer): never {
  callback(node);
  throw callback;
}
function getsItBack(node: N, base: number) {
  let hits = base;
  const returned = returnsItsCallback(node, () => { hits++; return true; });
  let thrown: unknown;
  try { throwsItsCallback(node, () => { hits += 10; return false; }); } catch (error) { thrown = error; }
  keptCallbacks.push(returned!, thrown as (element: N) => Answer);
  keptReaders.push(() => hits);
  return hits;
}

for (let round = 0; round < 3; round++) {
  say("round", round,
    capturesNothing(leaf), capturesANumber(leaf, 9 + round), countsInItsScope(leaf), quits(leaf, 4 + round), keepsItself(leaf), declarationKeepsItself(leaf, 14 + round),
    keepsAClosureOverItsScope(leaf, round * 1000), keepsWhatItCaptures(leaf), walksAgainInside(leaf), throwsFromInside(leaf), throughAnotherFunction(leaf, 2 + round),
    isKeptByTheCallee(leaf, 6 + round), getsItBack(leaf, round * 100));
  say("trampled", trample(40, round, round + 1, round + 2) !== 0);
}
say("kept callbacks", keptCallbacks.length, keptCallbacks.map(callback => String(callback(leaf))).join());
say("they walk", keptCallbacks.map(callback => findUp(leaf, callback)?.kind ?? -1).join());
say("kept readers", keptReaders.map(reader => reader()).join(), keptReaders.map(reader => reader()).join());
say("kept objects", keptObjects.map(box => box.count).join(), new Set(keptObjects).size);
say("later", later.map(({ node, callback }) => findUp(node, callback)?.kind ?? -1).join());
say("identity", keptCallbacks[0] !== keptCallbacks[2], new Set(keptCallbacks).size);

console.log(lines.join("\n"));
