// Promise.resolve of every sort of operand: primitives, the same promise, thenables that fulfill, reject and throw, a subclass; and what Bun.peek reads out of a promise.
const log = (...values: unknown[]) => console.log(...values);
const one = Promise.resolve(1);
log(await one, await Promise.resolve(), await Promise.resolve("text"), await Promise.resolve(null), await Promise.resolve(10n), typeof (await Promise.resolve(Symbol.iterator)));
one.then(v => log("then", v), e => log("never", e));
Promise.resolve(2).catch(e => log("never", e)).finally(() => log("finally"));
const same = Promise.resolve(one);
log(same === one);
const thenable = { then(resolve: (v: number) => void) { resolve(7); } };
log(await Promise.resolve(thenable));
const failing = { then(_: unknown, reject: (e: unknown) => void) { reject(new RangeError("from then")); } };
try { await Promise.resolve(failing); } catch (e) { log((e as Error).name, (e as Error).message); }
const throwing = { get then() { throw new TypeError("getter"); } };
await Promise.resolve(throwing).then(() => log("never"), e => log("rejected", e.message));
class Mine<T> extends Promise<T> {}
log(Mine.resolve(3) instanceof Mine, await Mine.resolve(3), Promise.resolve(Mine.resolve(4)) instanceof Mine);
log(Bun.peek(one), Bun.peek.status(one), Bun.peek.status(new Promise(() => {})), Bun.peek(5 as any));
const rejected = Promise.reject(new Error("no")); rejected.catch(() => {});
log(Bun.peek.status(rejected), (Bun.peek(rejected) as unknown as Error).message);
