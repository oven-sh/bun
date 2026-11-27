type Samples = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const tools: Record<string, (samples: Samples, by: number) => number> = {
  total(samples) { let sum = 0; for (let i = 0; i < samples.length; i++) sum += samples[i]; return sum; },
  fill(samples, by) { for (let i = 0; i < samples.length; i++) samples[i] = (i - 3) * by; return samples.length; },
  past(samples, by) { let sum = 0; for (let i = 0; i < by; i++) { const read = samples[i]; sum += read === undefined ? 1000 : read; } return sum; },
  storesPast(samples, by) { for (let i = 0; i < by; i++) samples[i] = i + 0.5; return samples.length; },
};
const call = (name: string, samples: Samples, by: number) => tools[JSON.parse(JSON.stringify(name))](samples, by);
const makers = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
const factors = [1, -1, 0.5, 100.75, -100.75, 70000.5, 5e9, -5e9, NaN, Infinity, -Infinity, 1e300, 0.49999999999999994, 2.5, 3.5, -0];
for (const maker of makers) {
  const out: string[] = [];
  for (const by of factors) { const samples = new maker(9); call("fill", samples, by); out.push(String(call("total", samples, 0)), Array.from(samples as any).join()); }
  const short = new maker(4); call("storesPast", short, 7);
  console.log(maker.name, out.join(" "), call("past", short, 7), Array.from(short as any).join());
}
