// `box.inner.bytes[i]` in a file without types: every box on the way is asked for its shape in front of the loop, each field is read once there, and what the last gives is told apart. Whatever stores a field on the way in a turn is seen by the next read. Three boxes lie on the way.
function sum(box) { let s = 0; for (let i = 0; i < box.a.b.bytes.length; i++) s += box.a.b.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const box = { a: { b: { bytes: new Uint8Array(6).fill(3) } } };
for (const next of [new Uint8Array(6).fill(3), [0.5, 1.5], Buffer.from([1, 2, 3])]) { box.a.b.bytes = next; console.log(go(box)); }
