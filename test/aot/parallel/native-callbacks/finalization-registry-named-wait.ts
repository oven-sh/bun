// A FinalizationRegistry whose only holder is a local variable that nothing reads again may be collected while its function waits, and then its callback never runs: the language allows
// that, and compiled code does it. A registry that is named once more behind the wait, or that lies at module level, runs its callback.
function tick() { Bun.gc(true); return Bun.sleep(0); }
// What a call leaves on the stack lies below every frame that is there when a collection looks.
function farDown<T>(levels: number, make: () => T): T { const made = levels > 0 ? farDown(levels - 1, make) : make(); return made; }
async function namedBehindTheWait(make: () => object[]): Promise<string> {
  let collected = 0;
  const registry = new FinalizationRegistry(() => collected++);
  const tracked = farDown(2000, () => { const made = make(); for (const value of made) registry.register(value, undefined); return made.length; });
  let rounds = 0;
  while (collected < tracked && rounds++ < 400) await tick();
  registry.unregister(registry);
  return collected + " of " + tracked;
}
let collectedAtModuleLevel = 0;
const atModuleLevel = new FinalizationRegistry(() => collectedAtModuleLevel++);
async function heldAtModuleLevel(make: () => object[]): Promise<string> {
  const before = collectedAtModuleLevel;
  const tracked = farDown(2000, () => { const made = make(); for (const value of made) atModuleLevel.register(value, undefined); return made.length; });
  let rounds = 0;
  while (collectedAtModuleLevel - before < tracked && rounds++ < 400) await tick();
  return collectedAtModuleLevel - before + " of " + tracked;
}
for (const [label, make] of [["objects", () => [{ a: 1 }, [1, 2]]], ["host objects", () => [new Blob(["x"]), new Blob(["xy"]).slice(0, 1), new Response("x")]]] as [string, () => object[]][]) {
  console.log(label, "| named behind the wait:", await namedBehindTheWait(make), "| at module level:", await heldAtModuleLevel(make));
}
