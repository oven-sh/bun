// An async function that is awaited by name throws before its first await, after it, in a finally, while its caller stands in try, catch and finally blocks: the caller sees the error in the same turn as ever.
const log: string[] = [];
const settled = Promise.resolve(0);
function ticks(name: string, count: number): void {
  let chain: Promise<unknown> = settled;
  for (let i = 1; i <= count; i++) chain = chain.then(() => log.push(name + " tick " + i));
}

async function throwsAtOnce(n: number): Promise<number> {
  if (n > 0) throw new Error("at once " + n);
  return n;
}
async function throwsText(n: number): Promise<string> {
  if (n > 0) throw "text " + n;
  return "fine";
}
async function throwsUndefined(): Promise<void> {
  throw undefined;
}
async function throwsAPromise(): Promise<void> {
  throw Promise.resolve("a promise as the reason");
}
async function throwsLater(n: number): Promise<number> {
  log.push("later enters " + n);
  await throwsAtOnce(0);
  log.push("later resumes " + n);
  throw new RangeError("later " + n);
}
async function throwsInDefault(n: number = ((): number => { throw new Error("in a default"); })()): Promise<number> {
  return n;
}
async function throwsInPattern({ a }: { a: number }): Promise<number> {
  return a;
}
async function throwsFromCallee(n: number): Promise<number> {
  return (await throwsLater(n)) + 1;
}
async function overflows(n: number): Promise<number> {
  return 1 + (await overflows(n + 1));
}
async function cleansUp(n: number): Promise<number> {
  try {
    return await throwsLater(n);
  } catch (error) {
    log.push("cleansUp caught " + (error as Error).message);
    throw new Error("wrapped " + (error as Error).message);
  } finally {
    log.push("cleansUp finally " + n);
    await throwsAtOnce(0);
    log.push("cleansUp finally goes on " + n);
  }
}
async function finallyWins(n: number): Promise<number> {
  try {
    await throwsAtOnce(n);
    return 1;
  } finally {
    const value = await throwsAtOnce(0);
    if (n === 2) return value + 100;
  }
}
async function finallyThrows(n: number): Promise<number> {
  try {
    return await throwsAtOnce(0);
  } finally {
    await throwsLater(n);
  }
}
async function loops(n: number): Promise<string> {
  let seen = "";
  for (let i = 0; i < n; i++) {
    try {
      seen += await throwsAtOnce(i & 1);
      if (i === 3) continue;
      seen += await throwsText(i & 2);
    } catch (error) {
      seen += "(" + (error instanceof Error ? error.message : String(error)) + ")";
      if (i === 4) break;
    } finally {
      seen += ";";
    }
  }
  return seen;
}

function text(error: unknown): string {
  return error instanceof Error ? error.name + ": " + error.message : error instanceof Promise ? "a promise" : String(error);
}
async function probe(name: string): Promise<void> {
  try { await throwsAtOnce(1); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await throwsText(2); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await throwsUndefined(); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await throwsAPromise(); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await throwsLater(3); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await throwsInDefault(); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await throwsInPattern(null as unknown as { a: number }); } catch (error) { log.push(name + " caught " + (error as Error).name); }
  try { await throwsFromCallee(4); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await cleansUp(5); } catch (error) { log.push(name + " caught " + text(error)); }
  try { log.push(name + " finallyWins " + (await finallyWins(0))); } catch (error) { log.push(name + " caught " + text(error)); }
  try { log.push(name + " finallyWins " + (await finallyWins(1))); } catch (error) { log.push(name + " caught " + text(error)); }
  try { log.push(name + " finallyWins " + (await finallyWins(2))); } catch (error) { log.push(name + " caught " + text(error)); }
  try { await finallyThrows(6); } catch (error) { log.push(name + " caught " + text(error)); }
  log.push(name + " loops " + (await loops(6)));
  log.push(name + " is fine " + (await throwsAtOnce(0)));
}

async function main(): Promise<void> {
  ticks("early", 30);
  const a = probe("a");
  const b = probe("b");
  ticks("between", 30);
  await a;
  await b;
  try { await overflows(0); } catch (error) { log.push("overflow: " + (error as Error).name); }
  log.push("after the overflow " + (await throwsAtOnce(0)));
}

main().then(() => {
  for (const line of log) console.log(line);
});
