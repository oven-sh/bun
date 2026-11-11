// `box.a[i] + box.b[i]` in a file without types: the front end says of each field "a text or a list". In front of the loop the box is asked for its shape, the first field is read once and told apart, and in each copy the other field is expected to give the same kind. A turn stores the other field: the next read sees it.
function sum(box) { let s = 0; for (let i = 0; i < box.a.length; i++) { s += box.a[i] + box.b[i]; if (i === 1 && box.next) { box.b = box.next; box.next = null; } } return s; }
const go = { sum }[JSON.parse('"sum"')];
const box = { a: new Uint8Array(5).fill(3), b: new Uint8Array(5).fill(4), next: null };
for (const [b, next] of [[new Uint8Array(5).fill(4), [10.5, 20.5, 30.5, 40.5, 50.5]], [[1, 2, 3, 4, 5], new Uint8Array(5).fill(9)], [new Uint8Array(5).fill(4), Buffer.from([7, 7, 7, 7, 7])], [new Uint8Array(5).fill(4), null]]) { box.b = b; box.next = next; console.log(go(box)); }
