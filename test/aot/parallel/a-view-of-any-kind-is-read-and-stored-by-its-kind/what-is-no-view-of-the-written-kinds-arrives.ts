type Samples = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const tools: Record<string, (samples: Samples) => unknown> = {
  total(samples) { let sum: any = 0; for (let i = 0; i < samples.length; i++) sum += samples[i]; return sum; },
  fill(samples) { for (let i = 0; i < samples.length; i++) (samples as any)[i] = typeof samples[i] === "bigint" ? 7n : i * 2.5; return samples.length; },
};
const call = (name: string, samples: unknown) => { try { return String(tools[JSON.parse(JSON.stringify(name))](samples as Samples)); } catch (error) { return (error as Error).constructor.name; } };
class Mine extends Float64Array { get length() { return 2; } }
class Plain extends Int16Array {}
const withLength = new Float32Array(5); Object.defineProperty(withLength, "length", { value: 3 });
const otherAbove = new Uint16Array(5); Object.setPrototypeOf(otherAbove, { length: 2 });
const strangers: unknown[] = [new BigInt64Array(3), new BigUint64Array(2), new (globalThis as any).Float16Array(3), [1.5, 2.5, "x"], "text", { length: 2, 0: 4, 1: 5 }, new Mine(4), new Plain(4), Buffer.from([1, 2, 3]), withLength, otherAbove, new DataView(new ArrayBuffer(4)), null, undefined, 5];
for (let turn = 0; turn < 3; turn++) for (const stranger of strangers) console.log(call("fill", stranger), call("total", stranger), call("total", new Float64Array([1.5, turn])));
