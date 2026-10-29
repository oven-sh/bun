// proxy[index] hands the get trap the index as a string, proxy[index] = value the set trap, and index in proxy the has trap. Compiled code takes the strings of small indexes from where they are kept and calls the trap itself. It asks the run time the first time, behind a collection, and for an index that is large, negative or no integer.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetByVal") + count("operationAOTGetByValAndCache") + count("operationAOTGetWithProxyTrap") + count("operationAOTPutByVal") + count("operationAOTPutByValAndCache") + count("operationAOTPutByValAndCacheSloppy") + count("operationAOTSetWithProxyTrap") + count("operationAOTFinishSetThroughProxy");
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const readAt = (object, index) => object[index];

function attempt(label, work) {
  let answer;
  try { answer = String(work()); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; }
  console.log(label + ": " + answer);
}
function measure(label, read, bound) {
  for (let i = 0; i < 40; i++) read(i);
  const before = asked();
  let text = "";
  for (let i = 0; i < 1000; i++) text = String(read(i));
  console.log(label + ": " + text + " | " + (asked() - before <= bound));
}

const numbers = [10, 11, 12, 13, 14, 15, 16, 17];
const seen = new Set;
const noting = new Proxy(numbers, { get(target, key, receiver) { seen.add(typeof key + " " + String(key)); return target[key]; } });
measure("the trap reads the target", i => readAt(noting, i & 7) + readAt(noting, (i + 1) & 7), 20);
console.log([...seen].sort().join());
const handingOn = new Proxy(numbers, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } });
measure("the trap hands on", i => readAt(handingOn, i & 7), 20);
measure("the trap answers by the key", i => readAt(measure.echo ??= new Proxy({}, { get(target, key) { return key + key.length; } }), i % 40), 20);
measure("a loop over a list behind a proxy", i => { let sum = 0; for (let at = 0; at < handingOn.length; at++) sum += handingOn[at]; return sum; }, 20);
measure("a constant index", i => handingOn[3] + noting[0], 20);
const many = new Proxy({}, { get(target, key) { return typeof key + key; } });
for (const index of [0, 9, 10, 99, 1023, 1024, 1025, 65536, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, -1, -0, 0.5, 1e21, NaN, Infinity, 7n, "7", "07", true, null])
  attempt("index " + (Object.is(index, -0) ? "-0" : typeof index + " " + String(index)), () => { let answer; for (let i = 0; i < 40; i++) answer = readAt(many, index); return answer; });
attempt("one string a small index", () => { const keys = []; const keeper = new Proxy({}, { get(target, key) { keys.push(key); return 0; } }); for (let i = 0; i < 40; i++) readAt(keeper, 5); return keys.every(key => key === "5") + " " + keys.length; });
attempt("behind collections", () => { let sum = 0; for (let round = 0; round < 5; round++) { collect(); for (let i = 0; i < 300; i++) sum += readAt(handingOn, i & 7) + Number(readAt(many, 200 + i).slice(6)); } return sum; });

// Whatever a proxy can be.
const bare = new Proxy(numbers, {});
measure("no trap", i => readAt(bare, i & 7), 2000);
attempt("no trap, past the end", () => [readAt(bare, 8), readAt(bare, 1000), readAt(new Proxy([, 1], {}), 0)].join());
const { proxy: revocable, revoke } = Proxy.revocable(numbers, { get(target, key) { return target[key]; } });
attempt("before it is revoked", () => { let sum = 0; for (let i = 0; i < 40; i++) sum += readAt(revocable, i & 7); return sum; });
revoke();
for (let round = 0; round < 3; round++) attempt("revoked", () => readAt(revocable, 1));
const frozen = new Proxy(Object.freeze([1, 2]), { get(target, key) { return key === "1" ? 5 : target[key]; } });
for (let round = 0; round < 3; round++) { attempt("a frozen target, the same value", () => readAt(frozen, 0)); attempt("a frozen target, another value", () => readAt(frozen, 1)); }
attempt("a trap that throws", () => { let caught = 0; const thrower = new Proxy([], { get(target, key) { throw new RangeError("no " + key); } }); for (let i = 0; i < 40; i++) try { readAt(thrower, i & 3); } catch (error) { if (error.message === "no " + (i & 3)) caught++; } return caught; });
attempt("a trap that is no function", () => readAt(new Proxy([], { get: 1 }), 0));
attempt("a proxy of a proxy", () => { let answer; const outer = new Proxy(noting, { get(target, key, receiver) { return target[key] + 100; } }); for (let i = 0; i < 40; i++) answer = readAt(outer, i & 7); return answer; });
attempt("a proxy above the receiver", () => { let answer; const heir = Object.create(many); for (let i = 0; i < 40; i++) answer = readAt(heir, i & 7); return answer; });
attempt("a proxy above an array", () => { let answer; const list = [1, , 3]; Object.setPrototypeOf(list, many); for (let i = 0; i < 40; i++) answer = [readAt(list, 0), readAt(list, 1), readAt(list, 5)].join(); return answer; });
attempt("bytes behind a proxy", () => { let sum = 0; const bytes = new Proxy(new Uint8Array([1, 2, 3]), { get(target, key) { return target[key]; } }); for (let i = 0; i < 40; i++) sum += readAt(bytes, i % 3); return sum + " " + readAt(bytes, 3); });
attempt("a text behind a proxy", () => { let text = ""; const letters = new Proxy(new String("abc"), { get(target, key) { return target[key]; } }); for (let i = 0; i < 40; i++) text = readAt(letters, i % 3) + readAt(letters, 3); return text; });
attempt("the same site meets other things", () => [readAt(numbers, 1), readAt("text", 1), readAt({ 1: "own" }, 1), readAt(noting, 1), readAt(new Uint8Array([4, 5]), 1), readAt(many, 1)].join());

// Stores.
const storeAt = (object, index, value) => { "use strict"; object[index] = value; };
const storeAtSloppy = new Function("object", "index", "value", "object[index] = value; return 'stored';");
const written = [0, 0, 0, 0, 0, 0, 0, 0];
const storedUnder = new Set;
const storing = new Proxy(written, { set(target, key, value, receiver) { storedUnder.add(typeof key + " " + key + " " + (receiver === storing)); target[key] = value + 1; return true; } });
measure("the trap stores to the target", i => { storeAt(storing, i & 7, i); storeAt(storing, (i + 1) & 7, -i); return written.join(); }, 20);
console.log([...storedUnder].sort().join());
const storingOn = new Proxy(written, { set(target, key, value, receiver) { return Reflect.set(target, key, value, receiver); } });
attempt("the trap hands on", () => { for (let i = 0; i < 100; i++) storeAt(storingOn, i & 7, i); return written.join(); });
const keysStored = [];
const listing = new Proxy({}, { set(target, key, value) { keysStored.push(typeof key + " " + String(key)); return true; } });
for (const index of [0, 10, 1023, 1024, 4294967294, 4294967295, -1, -0, 0.5, NaN, "7", 7n])
  attempt("store under " + (Object.is(index, -0) ? "-0" : typeof index + " " + String(index)), () => { keysStored.length = 0; for (let i = 0; i < 40; i++) storeAt(listing, index, i); return keysStored.length + " " + keysStored[39]; });
const refusing = new Proxy([], { set() { return false; } });
for (let round = 0; round < 3; round++) { attempt("a trap that says no, strict", () => { for (let i = 0; i < 20; i++) storeAt(refusing, 1, i); }); attempt("a trap that says no, sloppy", () => { let answer; for (let i = 0; i < 20; i++) answer = storeAtSloppy(refusing, 1, i); return answer; }); }
const bareStores = new Proxy([1, 2, 3], {});
attempt("no trap", () => { for (let i = 0; i < 40; i++) storeAt(bareStores, i % 5, i); return [bareStores.length, bareStores[4], bareStores[0]].join(); });
const frozenStores = new Proxy(Object.freeze([1, 2]), { set() { return true; } });
for (let round = 0; round < 3; round++) { attempt("a frozen target, the same value", () => storeAt(frozenStores, 0, 1)); attempt("a frozen target, another value", () => storeAt(frozenStores, 0, 5)); }
const stores = Proxy.revocable([], { set() { return true; } });
attempt("before it is revoked", () => { for (let i = 0; i < 40; i++) storeAt(stores.proxy, i & 3, i); return "stored"; });
stores.revoke();
for (let round = 0; round < 3; round++) attempt("revoked", () => storeAt(stores.proxy, 1, 1));
attempt("a set trap that throws", () => { let caught = 0; const thrower = new Proxy([], { set(target, key) { throw new RangeError("no " + key); } }); for (let i = 0; i < 40; i++) try { storeAt(thrower, i & 3, i); } catch (error) { if (error.message === "no " + (i & 3)) caught++; } return caught; });
attempt("a proxy above the receiver", () => { const seenAbove = []; const heir = Object.create(new Proxy({}, { set(target, key, value, receiver) { seenAbove.push(key + (receiver === heir)); return true; } })); for (let i = 0; i < 40; i++) storeAt(heir, i & 3, i); return seenAbove.length + " " + seenAbove[39] + " " + Object.keys(heir).length; });
attempt("stores behind collections", () => { for (let round = 0; round < 5; round++) { collect(); for (let i = 0; i < 300; i++) storeAt(storing, i & 7, i); } return written.join(); });
attempt("the same site stores to other things", () => { const list = [0, 0], bytes = new Uint8Array(2), record = {}; for (const each of [list, bytes, record, storing]) storeAt(each, 1, 9); return [list[1], bytes[1], record[1], written[1]].join(); });

// Presence.
const hasAt = (object, index) => index in object;
const askedAboutPresence = () => count("operationAOTInByValAndCache") + count("operationAOTHasWithProxyTrap");
function measurePresence(label, ask, bound) {
  for (let i = 0; i < 40; i++) ask(i);
  const before = askedAboutPresence();
  let text = "";
  for (let i = 0; i < 1000; i++) text = String(ask(i));
  console.log(label + ": " + text + " | " + (askedAboutPresence() - before <= bound));
}
const askedUnder = new Set;
const answering = new Proxy([1, 2, 3, 4], { has(target, key) { askedUnder.add(typeof key + " " + key); return Number(key) < target.length; } });
measurePresence("the has trap answers", i => hasAt(answering, i & 3) + " " + hasAt(answering, 4 + (i & 3)), 20);
console.log([...askedUnder].sort().join());
const answeringOn = new Proxy([1, 2, 3, 4], { has(target, key) { return Reflect.has(target, key); } });
measurePresence("the has trap hands on", i => hasAt(answeringOn, i & 7), 20);
const keysAsked = [];
const listingPresence = new Proxy({}, { has(target, key) { keysAsked.push(typeof key + " " + String(key)); return true; } });
for (const index of [0, 10, 1023, 1024, 4294967294, 4294967295, -1, -0, 0.5, NaN, "7", 7n])
  attempt("asked under " + (Object.is(index, -0) ? "-0" : typeof index + " " + String(index)), () => { keysAsked.length = 0; let yes = 0; for (let i = 0; i < 40; i++) yes += hasAt(listingPresence, index); return yes + " " + keysAsked.length + " " + keysAsked[39]; });
attempt("no has trap", () => { const bare = new Proxy([1, , 3], {}); let said = ""; for (let i = 0; i < 40; i++) said = [hasAt(bare, 0), hasAt(bare, 1), hasAt(bare, 2), hasAt(bare, 3)].join(); return said; });
for (const answer of [0, 1, "", "yes", null, undefined, {}, NaN]) attempt("the has trap says " + String(answer), () => { const p = new Proxy([], { has() { return answer; } }); let said; for (let i = 0; i < 20; i++) said = hasAt(p, 1); return said; });
for (let round = 0; round < 3; round++) {
  attempt("a target that binds the answer", () => [Object.freeze([1]), Object.preventExtensions([1]), Object.defineProperty([], 0, { value: 1, configurable: false })].map(target => { const p = new Proxy(target, { has() { return false; } }); try { return hasAt(p, 0) + " " + hasAt(p, 1); } catch (error) { return error.constructor.name; } }).join());
  attempt("a has trap that throws", () => { let caught = 0; const p = new Proxy([], { has(target, key) { throw new RangeError("no " + key); } }); for (let i = 0; i < 40; i++) try { hasAt(p, i & 3); } catch (error) { if (error.message === "no " + (i & 3)) caught++; } return caught; });
  attempt("revoked, asked", () => { const pair = Proxy.revocable([1], { has() { return true; } }); const before = hasAt(pair.proxy, 0); pair.revoke(); try { return hasAt(pair.proxy, 0); } catch (error) { return before + " " + error.constructor.name; } });
  attempt("a proxy above the object that is asked", () => { const asked = []; const heir = Object.create(new Proxy({}, { has(target, key) { asked.push(typeof key + key); return key === "2"; } })); heir[0] = 1; return [hasAt(heir, 0), hasAt(heir, 1), hasAt(heir, 2), asked.join()].join(" "); });
}
attempt("presence behind collections", () => { let yes = 0; for (let round = 0; round < 5; round++) { collect(); for (let i = 0; i < 300; i++) yes += hasAt(answering, i & 7); } return yes; });
attempt("the same site asks other things", () => [hasAt(answering, 1), hasAt([1, 2], 1), hasAt({ 1: "own" }, 1), hasAt(new Uint8Array(2), 1), hasAt(new Uint8Array(1), 1), hasAt(new String("ab"), 1), hasAt(new Map, 1)].join());
