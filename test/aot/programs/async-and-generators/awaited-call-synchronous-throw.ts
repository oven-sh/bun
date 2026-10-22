// An async function that is awaited where it is called throws before its first await: arguments, the body up to the throw, other jobs and the handler run in the order of plain Bun.
const log: string[] = [];
function note(text: string): string { log.push(text); return text; }
function ticks(label: string, count: number): void { let chain: Promise<unknown> = Promise.resolve(); for (let i = 1; i <= count; i++) chain = chain.then(() => { log.push(label + i); }); }
function text(error: unknown): string { return error instanceof Error ? error.name + " " + error.message : String(error); }
async function throwsAtOnce(a: string, b: string): Promise<string> { note("body " + a + b); throw new Error("at once " + a); }
async function throwsInDefault(a: string = ((): string => { note("default"); throw new RangeError("in a default"); })()): Promise<string> { return a; }
async function throwsLater(a: string): Promise<string> { note("body " + a); await null; note("resumed " + a); throw new Error("later " + a); }
async function returnsAtOnce(a: string): Promise<string> { note("body " + a); return a; }
function throwsInArgument(): string { note("argument"); throw new TypeError("in an argument"); }
async function inTry(): Promise<void> { ticks("t", 3); try { note("before"); await throwsAtOnce(note("x"), note("y")); note("not reached"); } catch (error) { note("caught " + text(error)); } finally { note("finally"); } }
async function withoutHandler(): Promise<string> { ticks("t", 3); note("before"); return (await throwsAtOnce("p", "q")) + note("not reached"); }
async function inLoop(): Promise<void> { ticks("t", 6); for (let i = 0; i < 3; i++) { try { note("value " + (i === 1 ? await throwsAtOnce("i", String(i)) : await returnsAtOnce("i" + i))); } catch (error) { note("caught " + text(error)); } } }
async function defaultThrows(): Promise<void> { ticks("t", 3); try { await throwsInDefault(); } catch (error) { note("caught " + text(error)); } }
async function argumentThrows(): Promise<void> { ticks("t", 3); try { await returnsAtOnce(throwsInArgument()); } catch (error) { note("caught " + text(error)); } }
async function callOutsideTry(): Promise<void> { ticks("t", 3); const pending = throwsAtOnce("o", "t"); try { note("between"); await pending; } catch (error) { note("caught " + text(error)); } }
async function nestedCalls(): Promise<void> { ticks("t", 4); try { await returnsAtOnce(await throwsAtOnce("n", "1")); } catch (error) { note("caught " + text(error)); } }
async function inFinally(): Promise<void> { ticks("t", 3); try { try { note("try"); } finally { await throwsAtOnce("f", "1"); } } catch (error) { note("caught " + text(error)); } }
async function afterAwait(): Promise<void> { ticks("t", 4); try { await throwsLater("l"); } catch (error) { note("caught " + text(error)); } }
async function returned(): Promise<string> { ticks("t", 3); try { return await throwsAtOnce("r", "1"); } catch (error) { return note("caught " + text(error)); } }
async function throughTwoCallers(): Promise<void> { ticks("t", 5); try { await withoutHandler(); } catch (error) { note("caught outside " + text(error)); } }
for (const run of [inTry, withoutHandler, inLoop, defaultThrows, argumentThrows, callOutsideTry, nestedCalls, inFinally, afterAwait, returned, throughTwoCallers]) {
  log.length = 0;
  try { await run(); } catch (error) { note("rejected " + text(error)); }
  for (let i = 0; i < 8; i++) await null;
  console.log(run.name + ": " + log.join(", "));
}
