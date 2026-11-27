// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. One kind after another comes in the same box.
function sum(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) s += box.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const data = new Uint8Array(5).fill(3);
const box = { bytes: data };
for (let turn = 0; turn < 2; turn++) for (const next of [data, Buffer.from([9, 8]), [1, 2.5], new Int16Array([-4, 4, 7]), "xy", [], new Uint8ClampedArray([300, 2]), ["a", 1]]) { box.bytes = next; console.log(go(box)); }
