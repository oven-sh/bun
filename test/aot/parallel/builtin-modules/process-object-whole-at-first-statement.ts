// The run time looks up the built-ins that compiled code names while the global object is still being created, and that builds the lazy members of `process`.
// Whatever they are built from has to be there by then: the standard streams queue ticks from native code, and a tick queued that way has to reach the one queue of the thread.
declare const console: { log(...values: unknown[]): void };
const order: string[] = [];
// A member that the program may replace is looked up before the program starts, so that compiled code can tell the original from the replacement.
if (process.argv.length > 7) {
  process.nextTick = (() => order.push("replaced")) as typeof process.nextTick;
  Object.defineProperty(process, "stdin", { value: undefined });
}
process.nextTick(() => order.push("tick 1"));
console.log(typeof process.stdin, typeof process.stdout, typeof process.stderr, typeof process.nextTick);
console.log(typeof process.stdin.isTTY === "boolean" || process.stdin.isTTY === undefined, typeof process.stdin.on, typeof process.stdout.write);
process.stdin.pause();
process.nextTick((a: string, b: number) => order.push("tick 2 " + a + b), "x", 1);
queueMicrotask(() => order.push("microtask"));
Promise.resolve().then(() => order.push("promise"));
setTimeout(() => {
  process.nextTick(() => { order.push("tick 3"); console.log(order.join(" | ")); });
}, 0);
process.stdout.write("written\n", () => order.push("write callback"));
