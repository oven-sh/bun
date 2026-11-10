// `box.a[i] + box.b[i]` in a file without types: the front end says of each field "a text or a list". In front of the loop the box is asked for its shape, the first field is read once and told apart, and in each copy the other field is expected to give the same kind. Both hold bytes.
function sum(box) { let s = 0; for (let i = 0; i < box.a.length; i++) s += box.a[i] + box.b[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const box = { a: new Uint8Array(7).fill(3), b: new Uint8Array(7).fill(4) };
for (let turn = 0; turn < 3; turn++) console.log(go(box));
