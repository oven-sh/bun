// A generator stores to a parameter in front of its first yield. Once it has taken its first step nothing holds the argument, however often the function that steps it waits.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
let last;
function make(n) {
  const value = { n };
  last = new WeakRef(value);
  return value;
}
function plain(n) {
  return { n };
}
function* storesTo(p, n) {
  p = plain(n);
  yield 1;
  yield 2;
  yield 3;
}
async function ask() {
  for (let round = 0; round < 4; round++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
  }
  return last.deref() !== undefined ? "kept" : "collected";
}
async function once() {
  const it = storesTo(make(1), 2);
  it.next();
  console.log("stepped twice:", await ask());
  it.next();
}
await once();
async function often() {
  const seen = {};
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 4; i++) {
      const it = storesTo(make(i), 2);
      it.next();
      const said = await ask();
      seen[said] = (seen[said] ?? 0) + 1;
      it.next();
    }
  }
  console.log("stepped twice, in a loop:", JSON.stringify(seen));
}
await often();
async function steppedInALoop() {
  const it = storesTo(make(1), 2);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    it.next();
    seen.push(await ask());
  }
  console.log("stepped by a loop that waits:", seen.join());
}
await steppedInALoop();
async function steppedOnOnePath(early) {
  const it = storesTo(make(1), 2);
  if (early) it.next();
  const first = await ask();
  it.next();
  console.log("stepped on one path:", first, await ask());
}
await steppedOnOnePath(true);
await steppedOnOnePath(false);
