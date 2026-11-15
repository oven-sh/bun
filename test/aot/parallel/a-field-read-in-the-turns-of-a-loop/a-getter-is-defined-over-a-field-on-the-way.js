// `box.inner.bytes[i]` and `box.bytes[i]`: a getter is defined under a written key over a plain field of the literal: the accessor lies in the slot. Nothing is read once in front there: every read runs the getter, and its calls are counted.
let asked = 0;
function deep(box) { let s = 0; for (let i = 0; i < box.inner.bytes.length; i++) s += box.inner.bytes[i]; return s; }
function flat(box) { let s = 0; for (let i = 0; i < box.bytes.length; i++) s += box.bytes[i]; return s; }
const go = { deep, flat };
const name = text => JSON.parse(text);
const held = { bytes: new Uint8Array([3, 4, 5]) };
const outer = { inner: held };
console.log(go[name('"deep"')](outer), asked);
Object.defineProperty(outer, "inner", { get() { asked++; return held; } });
console.log(go[name('"deep"')](outer), asked);
const plain = { bytes: new Uint8Array([1, 2]) };
console.log(go[name('"flat"')](plain), asked);
Object.defineProperty(plain, "bytes", { get() { asked += 100; return [0.5, 1.5, 2.5]; } });
console.log(go[name('"flat"')](plain), asked);
