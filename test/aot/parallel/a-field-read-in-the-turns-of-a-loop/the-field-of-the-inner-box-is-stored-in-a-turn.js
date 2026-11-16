// `box.inner.bytes[i]` in a file without types: every box on the way is asked for its shape in front of the loop, each field is read once there, and what the last gives is told apart. Whatever stores a field on the way in a turn is seen by the next read. A turn stores the inner box's field, by the way through the outer box and by another name of the inner box.
function sum(box, alias) { let s = 0; for (let i = 0; i < box.inner.bytes.length; i++) { s += box.inner.bytes[i]; if (i === 1 && box.next) { box.inner.bytes = box.next; box.next = null; } if (i === 2 && alias.other) { alias.bytes = alias.other; alias.other = null; } } return s; }
const go = { sum }[JSON.parse('"sum"')];
const inner = { bytes: new Uint8Array(6).fill(3), other: null };
const box = { inner, next: null };
for (const [first, next, other] of [[new Uint8Array(6).fill(3), [10.5, 20.5, 30.5, 40.5, 50.5], null], [new Uint8Array(6).fill(3), null, [1.5, 2.5, 3.5, 4.5, 5.5, 6.5]], [[1, 2, 3, 4], new Uint8Array(6).fill(9), Buffer.from([5, 5, 5, 5, 5, 5, 5])]]) { inner.bytes = first; box.next = next; inner.other = other; console.log(go(box, inner)); }
