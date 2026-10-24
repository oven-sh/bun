// What built ins make: programs c promises. It prints what plain Bun prints.
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

const table = new WebAssembly.Table({ element: "anyfunc", initial: 3 });
log(table.length, typeof table.length);
const memory = new WebAssembly.Memory({ initial: 1 });
log(memory.buffer.byteLength, memory.buffer === memory.buffer, memory.buffer instanceof ArrayBuffer);
const kept = { a: 1 };
const holder = new WebAssembly.Global({ value: "externref", mutable: true }, kept);
log(holder.value === kept, holder.valueOf() === kept);
holder.value = log; log(holder.value === log);
const number = new WebAssembly.Global({ value: "i32", mutable: true }, 5);
number.value = 6.7; log(number.value, new WebAssembly.Global({ value: "i64" }, 5n).value);
for (const read of [() => (WebAssembly.Table.prototype as any).length, () => (WebAssembly.Global.prototype as any).value, () => (WebAssembly.Memory.prototype as any).buffer, () => (WebAssembly.Instance.prototype as any).exports]) {
  try { log("answered", read()); } catch (e) { log((e as Error).name, (e as Error).message); }
}
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
log(Object.keys(instance.exports), (instance.exports.add as (a: number, b: number) => number)(2, 3), Object.getPrototypeOf(instance.exports));
const { instance: other } = await WebAssembly.instantiate(bytes);
log((other.exports.add as (a: number, b: number) => number)(4, 5));
