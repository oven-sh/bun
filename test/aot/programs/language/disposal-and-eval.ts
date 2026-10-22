// `using`, `await using` with disposers that throw, and direct eval that reads this, new.target, a capture and a private name.
const log: string[] = [];
function resource(name: string, failure?: string): any {
  return { [Symbol.dispose]() { log.push("dispose " + name); if (failure) throw failure; } };
}
function asyncResource(name: string, failure?: string): any {
  return { async [Symbol.asyncDispose]() { log.push("begin " + name); await undefined; log.push("end " + name); if (failure) throw failure; } };
}
function chain(e: any): string {
  return e && e.constructor && e.constructor.name === "SuppressedError" ? "S(" + chain(e.error) + ", " + chain(e.suppressed) + ")" : String(e);
}
function report(name: string, run: () => unknown) {
  log.length = 0;
  let outcome: string;
  try { outcome = "returned " + run(); } catch (e: any) { outcome = "threw " + chain(e); }
  console.log(name + ": " + outcome + " | " + log.join(", "));
}
async function reportAsync(name: string, run: () => Promise<unknown>) {
  log.length = 0;
  let outcome: string;
  try { outcome = "returned " + await run(); } catch (e: any) { outcome = "threw " + chain(e); }
  console.log(name + ": " + outcome + " | " + log.join(", "));
}

report("reverse order", () => { using a = resource("a"); using b = resource("b"); return "body"; });
report("one disposer throws", () => { using a = resource("a", "A"); using b = resource("b"); return "body"; });
report("two disposers throw", () => { using a = resource("a", "A"); using b = resource("b", "B"); return "body"; });
report("body and disposers throw", () => { using a = resource("a", "A"); using b = resource("b", "B"); throw "body"; });
report("null and undefined", () => { using a = null as any; using b = undefined as any; return "nothing to dispose"; });
report("not disposable", () => { using x = 1 as any; return "not reached"; });
report("no method", () => { using x = {} as any; return "not reached"; });

await reportAsync("await using", async () => { await using a = asyncResource("a"); await using b = asyncResource("b"); return "body"; });
await reportAsync("await using throws", async () => { await using a = asyncResource("a", "A"); await using b = asyncResource("b", "B"); throw "body"; });
await reportAsync("await using, sync fallback", async () => { await using a = resource("a", "A"); return "body"; });

const direct: any = eval;
class Secret {
  #hidden = "private value";
  seenTarget: boolean;
  constructor() {
    this.seenTarget = eval("new.target") === Secret;
  }
  readThis(): unknown { return eval("this") === this; }
  readPrivate(): unknown { return eval("this.#hidden"); }
  writePrivate(value: string): unknown { eval("this.#hidden = value"); return this.#hidden; }
  readArrow(): unknown { return (() => eval("this.#hidden"))(); }
}
const secret = new Secret();
console.log(secret.seenTarget, secret.readThis(), secret.readPrivate(), secret.writePrivate("changed"), secret.readArrow());
function readCapture(): unknown {
  let captured = 1;
  const read = () => eval("captured += 1; captured");
  read();
  return [read(), captured];
}
console.log(readCapture());
function plainFunction(this: any): unknown { return eval("new.target === undefined ? this : 'constructed'"); }
console.log(plainFunction.call("receiver"), new (plainFunction as any)() === undefined);
console.log(direct("typeof secret"), eval("typeof secret"));
export {};
