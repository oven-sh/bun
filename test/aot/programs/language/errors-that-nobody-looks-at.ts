// An Error that is thrown and caught in one function and never looked at need not be created. Everything that creating it can be seen to do stays: converting the message, reading `cause`, the constructor of a subclass, and the hooks that format a stack, which run when `stack` is read.
const log: string[] = [];

function caughtHere(r: number): number {
  try { if (r >= 0) throw new Error("x"); } catch { r += 1; }
  try { if (r >= 0) throw new TypeError("y"); } catch (e) { r += 2; }
  try { if (r >= 0) throw RangeError("z"); } catch { r += 3; }
  try { if (r < 0) throw new Error("never"); r += 4; } catch { r = -1; }
  return r;
}

function unusedOutsideTry(): number {
  new Error("unused");
  new SyntaxError();
  Error("called");
  return 1;
}

function messageIsConverted(): void {
  try { throw new Error({ toString() { log.push("toString"); return "m"; } } as unknown as string); } catch { log.push("caught 1"); }
  try { throw new Error(Symbol("s") as unknown as string); } catch (e) { log.push((e as Error).constructor.name); }
  new Error({ toString() { log.push("unused toString"); return "m"; } } as unknown as string);
  try { new Error({ toString() { throw new RangeError("from toString"); } } as unknown as string); } catch (e) { log.push((e as Error).message); }
}

function causeIsRead(): void {
  try { throw new Error("x", { get cause() { log.push("cause"); return 1; } }); } catch { log.push("caught 2"); }
  new Error("x", { get cause() { log.push("unused cause"); return 1; } });
  try { new Error("x", { get cause(): number { throw new TypeError("from cause"); } }); } catch (e) { log.push((e as Error).message); }
  new Error("x", new Proxy({}, { has(_, key) { log.push("has " + String(key)); return false; } }));
}

class Counted extends Error {
  static made = 0;
  constructor(message: string) {
    super(message);
    Counted.made++;
  }
}

function subclass(): number {
  try { throw new Counted("x"); } catch { }
  new Counted("y");
  return Counted.made;
}

function hooks(): void {
  const previous = (Error as any).prepareStackTrace;
  (Error as any).prepareStackTrace = (error: Error) => { log.push("prepare " + error.message); return "formatted"; };
  try { throw new Error("not looked at"); } catch { log.push("caught 3"); }
  try { throw new Error("looked at"); } catch (e) { log.push(String((e as Error).stack)); }
  (Error as any).prepareStackTrace = previous;
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  try { throw new Error("no frames"); } catch { log.push("caught 4"); }
  Error.stackTraceLimit = limit;
}

function looksAtIt(r: number): string {
  try { if (r >= 0) throw new Error("seen"); return "none"; } catch (e) { return (e as Error).message + " " + (e instanceof Error) + " " + typeof (e as Error).stack; }
}

function escapes(): unknown[] {
  const kept: unknown[] = [];
  try { throw new Error("kept"); } catch (e) { kept.push(e); }
  return kept;
}

console.log(caughtHere(0), caughtHere(5), caughtHere(-10), unusedOutsideTry());
messageIsConverted();
causeIsRead();
console.log(subclass());
hooks();
console.log(looksAtIt(1), looksAtIt(-1), (escapes()[0] as Error).message);
console.log(log.join("\n"));
