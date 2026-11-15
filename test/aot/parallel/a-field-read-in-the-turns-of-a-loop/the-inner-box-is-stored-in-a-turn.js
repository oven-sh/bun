// `box.inner.bytes[i]` in a file without types: every box on the way is asked for its shape in front of the loop, each field is read once there, and what the last gives is told apart. Whatever stores a field on the way in a turn is seen by the next read. A turn lays another inner box into the outer one: the next read goes through it.
function sum(box) { let s = 0; for (let i = 0; i < box.inner.bytes.length; i++) { s += box.inner.bytes[i]; if (i === 1 && box.spare) { box.inner = box.spare; box.spare = null; } } return s; }
const go = { sum }[JSON.parse('"sum"')];
const make = bytes => ({ bytes });
const box = { inner: make(new Uint8Array(5).fill(3)), spare: null };
for (const [first, next] of [[new Uint8Array(5).fill(3), [10.5, 20.5, 30.5, 40.5]], [[1, 2, 3], new Uint8Array(5).fill(9)], [new Uint8Array(5).fill(3), Buffer.from([7, 7, 7, 7, 7, 7])], [new Uint8Array(3).fill(2), null]]) { box.inner = make(first); box.spare = next && make(next); console.log(go(box)); }
