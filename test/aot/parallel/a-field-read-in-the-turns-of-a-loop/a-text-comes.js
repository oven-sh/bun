// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. A text comes.
function sum(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) s += box.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const data = "abcd";
const box = { bytes: data };
for (let turn = 0; turn < 3; turn++) console.log(go(box));
