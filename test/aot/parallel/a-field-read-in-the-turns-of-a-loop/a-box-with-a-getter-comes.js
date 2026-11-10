// `box.bytes[i]` in a file without types: in front of the loop the box is asked for its shape, the field is read once and what it gives is told apart. A box whose field is a getter, a box that finds it above, a frozen box and a proxy come: the getter and the trap run as often as they are written.
function sum(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) s += box.bytes[i]; return s; }
const go = { sum }[JSON.parse('"sum"')];
const key = JSON.parse('"bytes"'), holding = value => Object.fromEntries([[key, value]]);
const data = new Uint8Array(3).fill(3);
const box = { bytes: data };
let asked = 0;
const withGetter = Object.defineProperty({}, key, { get() { asked++; return asked > 4 ? new Uint8Array([7, 7, 7]) : [1, 2, 3]; } }), above = Object.create(holding(new Uint8Array([9, 9]))), frozen = Object.freeze(holding(new Uint8Array([4, 4])));
const proxied = new Proxy(holding(new Uint8Array([2, 2])), { get(target, name) { asked += 100; return target[name]; } });
for (let turn = 0; turn < 3; turn++) console.log(go(box), go(withGetter), asked, go(above), go(frozen), go(proxied), asked);
Object.freeze(box); console.log(go(box));
