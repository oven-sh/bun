const tools = {
  floats(samples: Float32Array | Float64Array) { let sum = 0; for (let i = 0; i < samples.length; i++) { samples[i] = samples[i] * 1.1; sum += samples[i]; } return sum; },
  bytes(samples: Uint8Array | Uint8ClampedArray) { let sum = 0; for (let i = 0; i < samples.length; i++) { samples[i] = samples[i] * 3 + 0.5; sum += samples[i]; } return sum; },
  bufferToo(samples: Buffer | Float64Array) { let sum = 0; for (let i = 0; i < samples.length; i++) { samples[i] = samples[i] + 200.5; sum += samples[i]; } return sum; },
  listToo(samples: Int32Array | Uint32Array | number[]) { let sum = 0; for (let i = 0; i < samples.length; i++) { samples[i] = samples[i] - 2147483649; sum += samples[i]; } return sum; },
  outsideLoops(samples: Int16Array | Float32Array, at: number) { samples[at] = samples[at + 1] + 40000.25; return samples[at] + samples.length; },
  maybe(samples: Int8Array | Uint32Array | undefined) { let sum = 0; if (samples) for (let i = 0; i < samples.length; i++) sum += samples[i]; return sum; },
} as Record<string, (...values: any[]) => number>;
const call = (name: string, ...values: unknown[]) => tools[JSON.parse(JSON.stringify(name))](...values);
for (let turn = 0; turn < 3; turn++) console.log(
  call("floats", new Float32Array([1.5, 2.5])), call("floats", new Float64Array([1.5, 2.5])), call("bytes", new Uint8Array([1, 100, 200])), call("bytes", new Uint8ClampedArray([1, 100, 200])),
  call("bufferToo", Buffer.from([1, 100])), call("bufferToo", new Float64Array([1, 100])), call("listToo", new Int32Array([1, 2])), call("listToo", new Uint32Array([1, 2])), call("listToo", [1, 2]),
  call("outsideLoops", new Int16Array([1, 2, 3]), 0), call("outsideLoops", new Float32Array([1, 2, 3]), 1), call("outsideLoops", new Float32Array([1, 2, 3]), 2), call("outsideLoops", new Int16Array(2), -1),
  call("maybe", new Int8Array([-1, -2])), call("maybe", new Uint32Array([4294967295, 1])), call("maybe", undefined));
