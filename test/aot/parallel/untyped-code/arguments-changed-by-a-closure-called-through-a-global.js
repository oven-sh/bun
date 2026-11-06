// A function hands a closure that changes its `arguments` to the global object, walks `arguments`, calls the closure through the global object and walks again.
// Several functions store under the one name, so the call has several callees.
const H = globalThis;
const S = JSON.stringify;

function elementIntoALiteral() { H.g = () => { arguments[0] = "handed"; }; const r = [0, ...arguments]; H.g(); return S(r) + S([0, ...arguments]); }
function elementIntoACopy() { H.g = () => { arguments[0] = "handed"; }; const r = [...arguments]; H.g(); return S(r) + S([...arguments]); }
function elementBesideParameters(a, b) { H.g = () => { arguments[0] = "handed"; arguments[1] = "too"; }; const r = [...arguments]; H.g(); return S(r) + S([...arguments]) + a + b; }
function lengthShorter() { H.g = () => { arguments.length = 1; }; const r = [...arguments]; H.g(); return S(r) + S([...arguments]); }
function lengthLonger() { H.g = () => { arguments[arguments.length] = "more"; arguments.length++; }; const r = [...arguments]; H.g(); return S(r) + S([...arguments]); }
function elementDeleted() { H.g = () => { delete arguments[0]; }; const r = [...arguments]; H.g(); return S(r) + S([...arguments]); }
function methodIntoASpread() { H.g = () => { arguments[Symbol.iterator] = function* () { yield "mine"; }; }; const r = [...arguments]; H.g(); return S(r) + S([...arguments]); }
function methodIntoALoop() { H.g = () => { arguments[Symbol.iterator] = function* () { yield "mine"; }; }; let r = ""; for (const x of arguments) r += x; H.g(); for (const x of arguments) r += "|" + x; return r; }
function methodIntoAPattern() { H.g = () => { arguments[Symbol.iterator] = function* () { yield "mine"; }; }; const [a] = arguments; H.g(); const [b] = arguments; return a + "|" + b; }
function elementIntoAPattern() { H.g = () => { arguments[0] = "handed"; }; const [a] = arguments; H.g(); const [b] = arguments; return a + "|" + b; }
function lengthIntoALoop() { H.g = () => { arguments.length = 1; }; let r = ""; for (const x of arguments) r += x; H.g(); for (const x of arguments) r += "|" + x; return r; }
function* methodIntoADelegation() { H.g = () => { arguments[Symbol.iterator] = function* () { yield "mine"; }; }; yield* arguments; H.g(); yield* arguments; }
function delegated() { return S([...methodIntoADelegation(...arguments)]); }
function insideTheWalk() { H.g = () => { arguments.length = 1; }; let r = ""; for (const x of arguments) { r += x; H.g(); } return r; }
function closureInAClosure() { H.g = () => () => { arguments[0] = "handed"; }; const r = [...arguments]; H.g()(); return S(r) + S([...arguments]); }

H.change = holder => { const held = Array.isArray(holder) ? holder[0] : holder.held; held[0] = "handed"; held.length = 1; };
function heldByAnObject() { const holder = { held: arguments }; const r = [...arguments]; H.change(holder); return S(r) + S([...arguments]); }
function heldByAList() { const holder = [arguments]; const r = [...arguments]; H.change(holder); return S(r) + S([...arguments]); }

const all = [
  elementIntoALiteral, elementIntoACopy, elementBesideParameters, lengthShorter, lengthLonger, elementDeleted,
  methodIntoASpread, methodIntoALoop, methodIntoAPattern, elementIntoAPattern, lengthIntoALoop, delegated, insideTheWalk, closureInAClosure,
  heldByAnObject, heldByAList,
];
for (const f of all) console.log(f.name, f("x", "y", 3), f("x"), f.apply(null, ["x", undefined]), f(...[1, 2, 3]), f());
