type Samples = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const marks: ((samples: Samples, i: number) => void)[] = [() => {}, (samples, i) => { if (i === 2) (samples.buffer as any).resize(8); }, (samples, i) => { if (i === 2) (samples.buffer as any).transfer(); }, (samples, i) => { if (i === 1) (samples.buffer as any).resize(64); }];
const tools: Record<string, (samples: Samples, mark: (samples: Samples, i: number) => void) => string> = {
  total(samples, mark) { let sum = 0, turns = 0; for (let i = 0; i < samples.length; i++) { mark(samples, i); const read = samples[i]; sum += read === undefined ? 100 : read; turns++; } return sum + ":" + turns; },
  fill(samples, mark) { let turns = 0; for (let i = 0; i < samples.length; i++) { mark(samples, i); samples[i] = i + 1; turns++; } return samples.length + ":" + turns; },
};
const call = (name: string, samples: Samples, mark: number) => tools[JSON.parse(JSON.stringify(name))](samples, marks[JSON.parse(String(mark))]);
for (const maker of [Int8Array, Uint16Array, Int32Array, Float32Array, Float64Array]) for (let mark = 0; mark < 4; mark++) for (const tracks of [true, false]) {
  const make = () => { const memory = new (ArrayBuffer as any)(32, { maxByteLength: 64 }); const samples = tracks ? new maker(memory) : new maker(memory, 0, 2); for (let i = 0; i < samples.length; i++) samples[i] = i + 1; return samples; };
  const read = make(), stored = make();
  console.log(maker.name, mark, tracks, call("total", read, mark), read.length, call("fill", stored, mark), stored.length, stored.length ? Array.from(stored as any).join() : "-");
}
const shared = new Int32Array(new (SharedArrayBuffer as any)(8, { maxByteLength: 32 }));
console.log(call("fill", shared, 0), call("total", shared, 0)); (shared.buffer as any).grow(16); console.log(shared.length, call("total", shared, 0), call("fill", shared, 0), call("total", shared, 0));
