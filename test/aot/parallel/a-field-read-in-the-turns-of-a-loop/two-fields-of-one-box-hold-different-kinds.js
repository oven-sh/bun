// `box.a[i] + box.b[i]` in a file without types: the front end says of each field "a text or a list". In front of the loop the box is asked for its shape, the first field is read once and told apart, and in each copy the other field is expected to give the same kind. Every pair of kinds lies in the two fields in turn; the second may be shorter.
function sum(box) { let s = 0; for (let i = 0; i < box.a.length; i++) s += box.a[i] + box.b[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const box = { a: new Uint8Array(3).fill(3), b: new Uint8Array(3).fill(4) };
const kinds = () => [new Uint8Array([1, 2, 3]), Buffer.from([4, 5, 6]), [0.5, 1.5, 2.5], [1, 2, 3], new Float64Array([0.25, 0.5, 0.75]), [1, , 3], ["x", "y", "z"], "abc", new Uint8Array(1), []];
for (const a of kinds()) console.log(kinds().map(b => { box.a = a; box.b = b; return String(go(box)); }).join(" | "));
