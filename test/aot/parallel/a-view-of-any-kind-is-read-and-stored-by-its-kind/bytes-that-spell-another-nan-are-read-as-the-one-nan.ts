// The bytes of a view of fractions may spell any of the 2^53 NaNs. Some of them, laid in a box as they are, would read as an int32, a cell or nothing at all.
type Samples = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
function gather(samples: Samples): unknown[] { const kept: unknown[] = []; for (let place = 0; place < samples.length; place++) kept.push(samples[place]); return kept; }
function sum(samples: Samples): number { let total = 0; for (let place = 0; place < samples.length; place++) total += samples[place]; return total; }
function move(from: Samples, into: Samples): void { for (let place = 0; place < from.length && place < into.length; place++) into[place] = from[place]; }
function show(kept: unknown[]): string { return kept.map(value => typeof value + ":" + String(value) + ":" + Object.is(value, NaN)).join(","); }
const words = [[0xffffffff, 0xffffffff], [0x00000007, 0xfffe0000], [0x00000001, 0xffff0000], [0x12345678, 0xfffc0000], [0x00000001, 0x7ff80000], [0x00000001, 0x7ff00000], [0x00000002, 0xfff00000], [0x00000000, 0xfffe0000], [0x00000006, 0x00000000], [0x0000000a, 0xfff80000]];
const halves = new Uint32Array(words.length * 2); words.forEach(([low, high], place) => { halves[place * 2] = low; halves[place * 2 + 1] = high; });
const doubles = new Float64Array(halves.buffer), floats = new Float32Array(halves.buffer);
const turns = Number(process.argv[2] ?? "30"); let out = "";
for (let turn = 0; turn < turns; turn++) out = show(gather(new Float64Array([1.5, 2.5, turn]))) + show(gather(new Int16Array([1, 2, turn]))) + sum(new Float32Array([0.5, turn]));
out += "\n" + show(gather(doubles)) + "\n" + show(gather(floats)) + "\n" + sum(doubles) + " " + sum(floats);
const other = new Float64Array(words.length), narrow = new Float32Array(words.length * 2), whole = new Int32Array(words.length);
move(doubles, other); move(floats, narrow); move(doubles, whole); move(doubles, narrow);
out += "\n" + show(gather(other)) + "\n" + show(gather(narrow)) + "\n" + show(gather(whole));
const holder: { kept: unknown } = { kept: 0 }; for (const value of gather(doubles)) { holder.kept = value; out += "|" + typeof holder.kept + (holder.kept === holder.kept); }
console.log(out);
