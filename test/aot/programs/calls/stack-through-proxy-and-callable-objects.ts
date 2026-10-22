// Stacks taken under a Proxy, Reflect.apply and a bound function, and of calls that fail in tail position, list the compiled frames plain Bun lists.
function frames(stack: unknown): string {
  const list: string[] = [];
  for (const line of String(stack).split("\n")) {
    const frame = /\b(t_\w+) \(.*:(\d+:\d+)\)$/.exec(line);
    if (frame) list.push(frame[1] + ":" + frame[2]);
  }
  return list.join(" < ");
}

let captured: string = "-";
function t_trap(target: unknown, self: unknown, list: unknown[]): never {
  captured = frames(new Error("in the trap").stack);
  throw new RangeError("from the trap");
}
function t_target(): never {
  captured = frames(new Error("in the target").stack);
  throw new RangeError("from the target");
}

const trapped: any = new Proxy(t_target, { apply: t_trap });
const untrapped: any = new Proxy(t_target, {});
const boundTrapped: any = trapped.bind(undefined);
const boundTarget: any = t_target.bind(undefined);

function report(name: string, error: any): void {
  console.log(name + ": caught " + error.constructor.name + " " + error.message);
  console.log("  captured: " + captured);
  console.log("  thrown: " + frames(error.stack));
}
function t_callsProxy(): void {
  try { trapped(1); } catch (error: any) { report("proxy with a trap", error); }
}
function t_callsReflectApply(): void {
  try { Reflect.apply(trapped, undefined, [1]); } catch (error: any) { report("Reflect.apply", error); }
}
function t_callsBoundProxy(): void {
  try { boundTrapped(1); } catch (error: any) { report("bound proxy", error); }
}
function t_callsBoundFunction(): void {
  try { boundTarget(); } catch (error: any) { report("bound function", error); }
}
function t_callsProxyWithoutTrap(): void {
  try { untrapped(); } catch (error: any) { report("proxy without a trap", error); }
}
t_callsProxy();
t_callsReflectApply();
t_callsBoundProxy();
t_callsBoundFunction();
t_callsProxyWithoutTrap();

const revocable = Proxy.revocable(t_target, {});
const revoked: any = revocable.proxy;
revocable.revoke();
const notCallable: any = Date.now() > 0 ? { not: "callable" } : t_target;

function t_tailCallsRevoked(): unknown {
  return revoked();
}
function t_tailCallsNotCallable(): unknown {
  return notCallable();
}
function t_outer(callee: () => unknown): unknown[] {
  const result = callee();
  return [result];
}
for (const callee of [t_tailCallsRevoked, t_tailCallsNotCallable]) {
  try {
    t_outer(callee);
  } catch (error: any) {
    console.log(callee.name + ": " + error.constructor.name + " [" + frames(error.stack) + "]");
  }
}
