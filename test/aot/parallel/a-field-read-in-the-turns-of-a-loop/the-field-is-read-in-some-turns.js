// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. Only some turns read the field, and a loop of no turns reads nothing.
function sum(box, n) { let s = 0; for (let i = 0; i < n; i++) if (i & 1) s += box.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const key = JSON.parse('"bytes"'), holding = value => Object.fromEntries([[key, value]]);
const data = new Uint8Array(6).fill(3);
const box = { bytes: data };
let asked = 0; const withGetter = Object.defineProperty({}, key, { get() { asked++; return data; } });
console.log(go(box, 6), go(box, 0), go(box, 9), go(withGetter, 6), asked, go(withGetter, 0), asked, go(withGetter, 1), asked);
try { console.log(go(null, 0), go(null, 1)); console.log(go(null, 2)); } catch (error) { console.log(error instanceof TypeError); }
