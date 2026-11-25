// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. null, a box without the field, no box and big integers come: they throw as in plain Bun.
function sum(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) s += box.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const key = JSON.parse('"bytes"'), holding = value => Object.fromEntries([[key, value]]);
const data = new Uint8Array(4).fill(3);
const box = { bytes: data };
console.log(go(box));
for (const other of [holding(null), Object.create(null), null, undefined, 5, holding(new BigInt64Array(1)), holding(7), holding(JSON.parse('{"length":2,"0":1,"1":2}'))]) { try { console.log(go(other)); } catch (error) { console.log(error instanceof TypeError); } }
console.log(go(box));
