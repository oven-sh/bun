// `const bytes = box.bytes` in front of a loop, in a file without types: the front end draws "a list of numbers" from `.length` and `[i]`. Nobody wrote that word: bytes, a buffer, any other view, a list of anything, a text or an object with a length may come.
function sum(box) { const bytes = box.bytes; let s = 0; for (let i = 0; i < bytes.length; i++) s += bytes[i]; return s; }
function scaled(box) { const bytes = box.bytes; let s = 0; for (let i = 0; i < bytes.length; i++) s = s + bytes[i] * 2; return s; }
function grown(box) { const bytes = box.bytes; let s = 0; for (let i = 0; i < bytes.length; i++) { s += bytes[i]; if (i === 1 && box.more > 0) { box.more--; box.bytes = box.other; bytes.length = bytes.length; } } return s; }
const go = { sum, scaled, grown }, names = JSON.parse('["sum","scaled","grown"]');
const tracked = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 })); tracked.fill(7);
const counted = { reads: 0, get length() { this.reads++; return 3; }, 0: 1.5, 1: "x", 2: 2 };
const boxes = [
  { bytes: new Uint8Array(5).fill(3) }, { bytes: Buffer.from([1, 2, 3, 250]) }, { bytes: new Float64Array([0.5, 1.25, -0]) }, { bytes: new Int16Array([-5, 7]) }, { bytes: new Uint8ClampedArray([300, -4, 9]) },
  { bytes: [1, 2, 3.5] }, { bytes: [1, , 3] }, { bytes: [1, "2", 3] }, { bytes: [] }, { bytes: "abc" }, { bytes: counted }, { bytes: tracked }, { bytes: new BigInt64Array(0) }, { bytes: new Uint8Array(0) },
  { bytes: [4, 5, 6], other: new Uint8Array(2), more: 1 }, { get bytes() { return [this.asked = (this.asked | 0) + 1, 10]; } }, Object.create({ bytes: new Uint8Array([9, 9]) }),
];
for (let turn = 0; turn < 3; turn++) for (const name of names) console.log(name, boxes.map(box => String(go[name](box))).join(" | "), counted.reads, boxes[15].asked);
for (const box of [{ bytes: null }, {}, null, { bytes: new BigInt64Array(1) }]) for (const name of names) { try { console.log(go[name](box)); } catch (error) { console.log(name, error instanceof TypeError); } }
tracked.buffer.resize(2); console.log(go[names[0]](boxes[11]), go[names[1]](boxes[11]));
