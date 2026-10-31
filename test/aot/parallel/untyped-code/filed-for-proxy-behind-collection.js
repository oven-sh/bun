// Compiled code hands a trap of a proxy the key as a string. For a name that the program writes, that string is made once and kept, so a collection takes away nothing that the next access through the proxy would have to look up again.
// Env: JSC_aotCountsPath=/dev/null
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = () => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for.
function callsIn(counts) {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined) sum += Number(calls);
  }
  return sum;
}
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
const before = countsSoFar();
for (let round = 0; round < 50; round++) {
  collect();
  for (let i = 0; i < 20; i++) sum += turn();
}
const after = countsSoFar();
console.log(sum, letters, "the run time is asked at most 10 times for 9000 accesses through proxies behind 50 collections:", callsIn(after) - callsIn(before) <= 10);
keys = [];
sum += turn();
console.log(sum, keys.join(" "), keys.every(key => typeof key === "string"));
// The strings are the same for the program as any other strings of those characters.
const held = new Map(keys.slice(0, 7).map(key => [key, key.length]));
collect();
console.log([...held].join(" "), held.get("al" + "pha".slice(0)), turn());
