// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. The turns store into what the field gives.
function sum(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) { box.bytes[i] = box.bytes[i] + 1; s += box.bytes[i]; } return s; }
const go = { sum }[JSON.parse('"sum"')];
const data = new Uint8Array(6).fill(254);
const box = { bytes: data };
console.log(go(box), go(box), go(box)); box.bytes = [1.5, 2]; console.log(go(box), go(box)); box.bytes = Buffer.from([255, 0]); console.log(go(box));
