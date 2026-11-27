// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. A call in a turn stores the field: the next read sees it.
function sum(box, deed) { let s = 0; for (let i = 0; i < box.bytes.length; i++) { s += box.bytes[i]; if (i === 1) deed(box); } return s; }
const go = { sum }[JSON.parse('"sum"')];
const key = JSON.parse('"bytes"'), holding = value => Object.fromEntries([[key, value]]);
const data = new Uint8Array(6).fill(3);
const box = { bytes: data };
const deeds = [b => { b[key] = [10, 20, 30, 40]; }, b => { b[key] = new Uint8Array(4).fill(9); }, () => {}, b => { b[key] = Buffer.from([5, 5, 5, 5, 5]); }, b => { delete b[key]; b[key] = [1, 1, 1]; }];
for (const deed of deeds) { box[key] = data; console.log(go(box, deed)); }
