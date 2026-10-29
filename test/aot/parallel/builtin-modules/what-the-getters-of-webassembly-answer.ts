// Every kind of value that the getters of the WebAssembly classes answer, each used as what it is.
const say = (...values: unknown[]) => console.log(...values);
function caught(run: () => unknown): unknown {
  try { return run(); } catch (e) { return `${(e as Error).name}: ${(e as Error).message}`; }
}
const table = new WebAssembly.Table({ element: "anyfunc", initial: 3 });
say(table.length + 1, typeof table.length);
say(caught(() => { const wide = new WebAssembly.Table({ element: "anyfunc", initial: 2n, address: "i64" } as any); return [typeof wide.length, String(wide.length)]; }));
const memory = new WebAssembly.Memory({ initial: 1 });
say(memory.buffer.byteLength, memory.buffer === memory.buffer, memory.buffer instanceof ArrayBuffer, new Uint8Array(memory.buffer)[0]);
const before = memory.buffer; memory.grow(1); say(before === memory.buffer, before.byteLength, memory.buffer.byteLength);
const shared = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
say(shared.buffer instanceof SharedArrayBuffer, shared.buffer.byteLength, Object.isFrozen(shared.buffer));
const tag = new WebAssembly.Tag({ parameters: ["i32"] });
say(new WebAssembly.Exception(tag, [1]).stack, typeof new WebAssembly.Exception(tag, [1], { traceStack: true }).stack);
const kept = { a: 1 };
const holder = new WebAssembly.Global({ value: "externref", mutable: true }, kept);
say(holder.value === kept, holder.valueOf() === kept, (holder.value as typeof kept).a);
holder.value = say; (holder.value as typeof say)("called through the global");
holder.value = "text"; say((holder.value as string).length);
const number = new WebAssembly.Global({ value: "i32", mutable: true }, 5);
number.value = 6.7; say(number.value + 1, new WebAssembly.Global({ value: "i64" }, 5n).value + 1n, new WebAssembly.Global({ value: "f64" }, 1.5).valueOf());
say(new WebAssembly.Global({ value: "anyfunc", mutable: true }, null as any).value);
for (const read of [() => (WebAssembly.Table.prototype as any).length, () => (WebAssembly.Global.prototype as any).value, () => (WebAssembly.Memory.prototype as any).buffer, () => (WebAssembly.Instance.prototype as any).exports, () => (WebAssembly.Exception.prototype as any).stack, () => WebAssembly.Global.prototype.valueOf.call({})])
  say(caught(read));
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
say(Object.keys(instance.exports), (instance.exports.add as (a: number, b: number) => number)(2, 3), Object.getPrototypeOf(instance.exports), instance.exports === instance.exports);
const { instance: other } = await WebAssembly.instantiate(bytes);
say((other.exports.add as (a: number, b: number) => number)(4, 5));
const functionHolder = new WebAssembly.Global({ value: "anyfunc", mutable: true }, instance.exports.add as any);
say((functionHolder.value as (a: number, b: number) => number)(6, 7));
