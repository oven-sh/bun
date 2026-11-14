// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. A turn deletes the field: the next read finds nothing and throws.
function sum(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) { s += box.bytes[i]; if (i === 2 && box.goes) delete box.bytes; } return s; }
const go = { sum }[JSON.parse('"sum"')];
const data = new Uint8Array(6).fill(3);
const box = { bytes: data, goes: false };
console.log(go(box)); box.goes = true;
try { console.log(go(box)); } catch (error) { console.log(error instanceof TypeError, "bytes" in box); }
try { console.log(go(box)); } catch (error) { console.log(error instanceof TypeError); }
box.goes = false; box.bytes = [4, 4]; console.log(go(box));
