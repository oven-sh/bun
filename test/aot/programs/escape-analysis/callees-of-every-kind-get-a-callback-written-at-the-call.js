// A callback written at the call is handed to a callee that nobody knows when the program is built: one that only calls it, one that keeps it, returns it, throws it, looks at it, hands it on.
// What was kept is used after the caller has returned and the stack has been written over.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const kept = [];
const box = { f: null };
function trample(n) { const a = [n, n + 1, n + 2, n + 3, n + 4, n + 5, n + 6, n + 7]; return n > 0 ? trample(n - 1) + a[n & 7] : a[0]; }

function onlyCalls(f) { return f(1) + f(2); }
function keeps(f) { kept.push(f); return f(3); }
function returns(f) { return f; }
function throwsIt(f) { throw f; }
function storesInField(f) { box.f = f; return 0; }
function handsOn(f) { return pick(callees, 1)(f); }
function handsOnToBorrower(f) { return onlyCalls(f); }
function capturesIt(f) { kept.push(() => f(4)); return 1; }
function readsName(f) { return f.name + "/" + f.length; }
function addsProperty(f) { f.tag = "t"; kept.push(f); return f.tag; }
function typeOfIt(f) { return typeof f; }
function comparesIt(f) { return f === box.f; }
function usesArguments() { kept.push(arguments[0]); return arguments.length; }
function usesRest(...all) { kept.push(all[0]); return all.length; }
function hasDefault(f = null, g = f) { kept.push(g); return 2; }
function takesNothing() { return "nothing"; }
function callsWithCall(f) { return f.call(null, 5); }
function callsWithApply(f) { return f.apply(null, [6]); }
function bindsIt(f) { kept.push(f.bind(null, 7)); return 3; }
async function isAsync(f) { await null; return f(8); }
function* isGenerator(f) { yield f(9); yield f(10); }
function instanceOfIt(f) { return f instanceof Function; }
function keysOfIt(f) { return Object.keys(f).length; }
function inWeakMap(f) { const m = new WeakMap(); m.set(f, 1); kept.push(f); return m.get(f); }
function stringOfIt(f) { return String(f).length > 0; }
const arrowCalls = f => f(11);
const bound = onlyCalls.bind(null);
const boundKeeper = keeps.bind(null);
const proxied = new Proxy(onlyCalls, {});
const proxiedKeeper = new Proxy(keeps, {});
const nativePush = Array.prototype.push.bind(kept);
const callees = [onlyCalls, keeps, returns, throwsIt, storesInField, handsOn, handsOnToBorrower, capturesIt, readsName, addsProperty, typeOfIt, comparesIt, usesArguments, usesRest, hasDefault,
  takesNothing, callsWithCall, callsWithApply, bindsIt, isAsync, isGenerator, instanceOfIt, keysOfIt, inWeakMap, stringOfIt, arrowCalls, bound, boundKeeper, proxied, proxiedKeeper, nativePush];

const lines = [];
const pending = [];
function hand(i, k) {
  const callee = pick(callees, i);
  let answer;
  try { answer = callee(v => v * 10 + k); } catch (thrown) { answer = thrown; }
  return answer;
}
function show(answer) {
  if (typeof answer === "function") return "function:" + answer(1);
  if (answer && typeof answer.then === "function") { pending.push(answer); return "promise"; }
  if (answer && typeof answer.next === "function") return "generator:" + [...answer].join();
  return String(answer);
}
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < callees.length; i++) {
    const answer = hand(i, round * 100 + i);
    trample(40);
    lines.push(i + " " + show(answer));
  }
}
if (typeof Bun !== "undefined") Bun.gc(true);
trample(60);
lines.push("kept " + kept.length + ": " + kept.map(f => f(2)).join());
lines.push("box " + box.f(3));
lines.push("distinct " + new Set(kept).size);
Promise.all(pending).then(all => { lines.push("awaited " + all.join()); console.log(lines.join("\n")); });
