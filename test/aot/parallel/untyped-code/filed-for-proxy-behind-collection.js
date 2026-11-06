// Compiled code hands a trap of a proxy the key as a string. For a name that the program writes, that string is made once and kept, so a collection takes away nothing that the next access through the proxy would have to look up again.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const operations = ["GetById", "GetByIdAndCache", "GetByVal", "GetByValAndCache", "GetGeneric", "GetByValGeneric", "InByIdAndCache", "InByValAndCache", "PutById", "PutByIdSloppy", "PutByIdAndCache", "FillSiteCache", "GetWithProxyTrap", "HasWithProxyTrap", "SetWithProxyTrap"];
const asked = () => operations.reduce((sum, name) => sum + count("operationAOT" + name), 0);
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
let keys = null;
let letters = 0;
const note = key => { letters += key.length; keys?.push(key); };
const target = { alpha: 1, beta: 2, gamma: 3, delta: 4 };
const busy = new Proxy(target, {
  get(object, key) { note(key); return object[key]; },
  has(object, key) { note(key); return key in object; },
  set(object, key, value) { note(key); object[key] = value; return true; },
});
const quiet = new Proxy(target, {});
function turn() {
  let sum = busy.alpha + busy.beta + busy.gamma + busy.delta + quiet.alpha + quiet.delta;
  if ("alpha" in busy) sum++;
  if ("omega" in busy) sum--;
  busy.beta = 2;
  return sum;
}
let sum = 0;
for (let i = 0; i < 60; i++) sum += turn();
letters = 0;
const before = asked();
for (let round = 0; round < 50; round++) {
  collect();
  for (let i = 0; i < 20; i++) sum += turn();
}
console.log(sum, letters, "the run time is asked at most 10 times for 9000 accesses through proxies behind 50 collections:", asked() - before <= 10);
keys = [];
sum += turn();
console.log(sum, keys.join(" "), keys.every(key => typeof key === "string"));
// The strings are the same for the program as any other strings of those characters.
const held = new Map(keys.slice(0, 7).map(key => [key, key.length]));
collect();
console.log([...held].join(" "), held.get("al" + "pha".slice(0)), turn());
