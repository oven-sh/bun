// `box.inner.bytes[i]` in a file without types: every box on the way is asked for its shape in front of the loop, each field is read once there, and what the last gives is told apart. Whatever stores a field on the way in a turn is seen by the next read. One kind after another lies in the inner box.
function sum(box) { let s = 0; for (let i = 0; i < box.inner.bytes.length; i++) s += box.inner.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const box = { inner: { bytes: new Uint8Array(5).fill(3) } };
for (let turn = 0; turn < 2; turn++) for (const next of [new Uint8Array(5).fill(3), Buffer.from([9, 8]), [1, 2.5], new Int16Array([-4, 4, 7]), "xy", [], ["a", 1], [1, , 2]]) { box.inner.bytes = next; console.log(go(box)); }
