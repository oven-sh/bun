type Samples = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const say = (made: any) => made === undefined || typeof made !== "object" ? String(made) : made.constructor.name + ":" + Array.from(made).join();
const tools: Record<string, (samples: Samples) => string> = {
  copies(samples) { const cut = (samples as any).slice(1, 3), part = (samples as any).subarray(1), twice = (samples as any).map((x: number) => x * 2.5), kept = (samples as any).filter((x: number) => x > 1); cut[0] = 300.75; part[0] = -1.5; return [cut, part, twice, kept, samples].map(say).join(" "); },
  changes(samples) { (samples as any).fill(3.5, 1, 2); (samples as any).reverse(); (samples as any).set([7.25], 0); (samples as any).copyWithin(2, 0, 1); (samples as any).sort(); return say(samples); },
  newer(samples) { return [(samples as any).with(0, 9.75), (samples as any).toReversed(), (samples as any).toSorted()].map(say).join(" "); },
  asks(samples) { return [samples.byteLength, samples.byteOffset, samples.BYTES_PER_ELEMENT, samples.buffer.byteLength, samples.length, (samples as any).at(-1), (samples as any).indexOf(2), (samples as any).includes(2), (samples as any).join("-"), samples.constructor.name, Object.prototype.toString.call(samples), samples[Symbol.toStringTag]].join(" "); },
  walks(samples) { let sum = 0; for (const x of samples) sum += x; (samples as any).forEach((x: number) => { sum += x; }); for (const [i, x] of (samples as any).entries() as Iterable<[number, number]>) sum += i * x; return sum + " " + (samples as any).reduce((a: number, x: number) => a + x, 0.5) + " " + [...(samples as any).keys()].join(); },
  moves(samples) { const other: Samples = samples; let bytes = 0; for (let i = 0; i < 3; i++) { samples.set(other, 0); (samples as any).set((samples as any).subarray(0, 1), 1); bytes += samples.byteLength + samples.byteOffset + samples.length; } return bytes + " " + say(samples); },
  inLoops(samples) { let out = ""; for (let i = 0; i < 3; i++) { const part = (samples as any).subarray(i); out += part.length + ":" + part[0] + ":" + part.constructor.name + " "; } return out; },
};
const call = (name: string, samples: Samples) => tools[JSON.parse(JSON.stringify(name))](samples);
for (const maker of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array])
  for (const name of Object.keys(tools)) console.log(maker.name, name, call(name, new maker([1, 2, 3, 4])));
