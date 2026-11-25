// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. A call in a turn shrinks, grows or transfers what lies under the view.
function sum(box, deed) { let s = 0; for (let i = 0; i < box.bytes.length; i++) { s += box.bytes[i]; if (i === 1) deed(box); } return s; }
const go = { sum }[JSON.parse('"sum"')];
const data = new Uint8Array(new ArrayBuffer(6, { maxByteLength: 16 })); data.fill(7);
const box = { bytes: data };
console.log(go(box, b => b.bytes.buffer.resize(3)), go(box, b => b.bytes.buffer.resize(9)), go(box, () => {}));
box.bytes = new Uint8Array(8).fill(2); console.log(go(box, b => b.bytes.buffer.transfer()), go(box, () => {}));
