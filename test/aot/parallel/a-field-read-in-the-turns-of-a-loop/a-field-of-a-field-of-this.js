// `box.inner.bytes[i]` in a file without types: every box on the way is asked for its shape in front of the loop, each field is read once there, and what the last gives is told apart. Whatever stores a field on the way in a turn is seen by the next read. The outer box is `this` in a method.
class Outer { constructor(inner) { this.inner = inner; } sum() { let s = 0; for (let i = 0; i < this.inner.bytes.length; i++) s += this.inner.bytes[i]; return s; } }
const name = JSON.parse('"sum"');
const outer = new Outer({ bytes: new Uint8Array(5).fill(3) });
for (const next of [new Uint8Array(5).fill(3), [0.5, 1.5], Buffer.from([1, 2, 3]), ["a", 1]]) { outer.inner.bytes = next; console.log(outer[name]()); }
