// Species: programs v typed array and buffer. It prints what plain Bun prints.
const log: string[] = [];
class Bytes extends Uint8Array { constructor(first: string | number | ArrayBuffer, ...rest: number[]) { super(first as any, ...rest); log.push("bytes " + Object.prototype.toString.call(first) + " " + rest.length); } }
class Store extends ArrayBuffer { constructor(size: string | number) { super(size as number); log.push("store " + typeof size); } }
class Shared extends SharedArrayBuffer { static get [Symbol.species](): any { log.push("shared getter"); return SharedArrayBuffer; } }
log.push(String(Bytes.from([1, 2, 3]).subarray(1) instanceof Bytes));
log.push(String(Bytes.of(1, 2).slice(1) instanceof Bytes));
log.push(String(new Store(4).slice(1) instanceof Store));
log.push(String(new Shared(4).slice(1).byteLength));
console.log(log.join("; "));
