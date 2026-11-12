// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. The element is kept in a constant and used twice in the turn.
function sum(box) { let s = 0, most = 0; for (let i = 0; i < box.bytes.length; i++) { const c = box.bytes[i]; s += c; if (c > most) most = c; } return s + most; }
const go = { sum }[JSON.parse('"sum"')];
const data = new Uint8Array([3, 9, 4, 250, 1]);
const box = { bytes: data };
for (let turn = 0; turn < 2; turn++) for (const next of [data, [1.5, 7.5, 2], Buffer.from([8, 2]), new Float64Array([0.5, -3]), [], [1, , 5], new Int8Array([-7, -2])]) { box.bytes = next; console.log(go(box)); }
