// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. A turn stores the field under another name of the same box: the next read sees it.
function sum(box, alias) { let s = 0; for (let i = 0; i < box.bytes.length; i++) { s += box.bytes[i]; if (i === 1 && alias.other) { const next = alias.other; alias.other = null; alias.bytes = next; } } return s; }
const go = { sum }[JSON.parse('"sum"')];
const data = new Uint8Array(6).fill(3);
const make = () => ({ bytes: data, other: null });
const box = make(), stranger = make();
for (const [first, next] of [[data, [10, 20, 30, 40]], [[1, 2, 3], new Uint8Array(5).fill(9)], [data, Buffer.from([7, 7, 7, 7, 7, 7, 7])]]) { box.bytes = first; box.other = next; console.log(go(box, box)); box.bytes = first; stranger.other = next; console.log(go(box, stranger)); }
