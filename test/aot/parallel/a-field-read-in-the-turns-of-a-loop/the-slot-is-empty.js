// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. A box of the same making whose field was never filled comes: the read finds nothing and throws.
function sum(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) s += box.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
function Box(bytes) { this.tag = 1; if (bytes) this.bytes = bytes; }
const data = new Uint8Array(4).fill(3);
const box = new Box(data), empty = new Box(null);
for (let turn = 0; turn < 2; turn++) { console.log(go(box)); try { console.log(go(empty)); } catch (error) { console.log(error instanceof TypeError); } }
empty.bytes = [5, 6]; console.log(go(empty));
