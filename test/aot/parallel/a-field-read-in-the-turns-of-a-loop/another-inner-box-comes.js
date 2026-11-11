// `box.inner.bytes[i]` in a file without types: every box on the way is asked for its shape in front of the loop, each field is read once there, and what the last gives is told apart. Whatever stores a field on the way in a turn is seen by the next read. The inner box is of another making, is found by a getter (its calls are counted), is null or is missing.
function sum(box) { let s = 0; for (let i = 0; i < box.inner.bytes.length; i++) s += box.inner.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const innerKey = JSON.parse('"inner"'), bytesKey = JSON.parse('"bytes"'), holding = (key, value) => Object.fromEntries([[key, value]]);
const box = { inner: { bytes: new Uint8Array(3).fill(3) } };
let asked = 0;
const byGetter = Object.defineProperty({}, innerKey, { get() { asked++; return holding(bytesKey, [1.5, 2.5]); } });
const innerByGetter = holding(innerKey, Object.defineProperty({}, bytesKey, { get() { asked += 100; return new Uint8Array([7, 7]); } }));
for (let turn = 0; turn < 3; turn++) console.log(go(box), go(holding(innerKey, holding(bytesKey, [4.5]))), go(byGetter), asked, go(innerByGetter), asked);
for (const other of [holding(innerKey, null), Object.create(null), null, holding(innerKey, Object.create(null)), holding(innerKey, 5)]) { try { console.log(go(other)); } catch (error) { console.log(error instanceof TypeError); } }
box.inner = null; try { console.log(go(box)); } catch (error) { console.log(error instanceof TypeError); }
