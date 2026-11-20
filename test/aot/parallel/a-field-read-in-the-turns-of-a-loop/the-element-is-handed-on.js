// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. The element goes into no operator: it is pushed onto a list and handed to a call.
function sum(box, out, take) { let n = 0; for (let i = 0; i < box.bytes.length; i++) { const c = box.bytes[i]; n += c; out.push(c); take(c); } return n; }
const go = { sum }[JSON.parse('"sum"')];
const data = new Uint8Array([3, 9, 4]);
const box = { bytes: data };
let seen = "";
for (const next of [data, [1.5, 7.5], Buffer.from([8, 2]), new Float64Array([0.5, -3])]) { box.bytes = next; const out = []; console.log(go(box, out, c => { seen += c + ";"; }), out.join(), seen); }
