// A typed array or a DataView over a buffer that can be resized, or over shared memory that can grow, is made, filled and read by the same functions as one over an ordinary buffer, before and behind a change of the size. As in plain Bun, and a validating build has nothing to find.
// Flags: --aot-validate
function fill(memory) { const bytes = new Uint8Array(memory); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 129) & 255; return memory; }
function sum(memory) { const bytes = new Uint8Array(memory); let total = 0; for (let i = 0; i < bytes.length; i++) total += bytes[i]; return total; }
function words(memory) { const view = new Uint16Array(memory); let total = 0; for (const word of view) total += word; return [view.length, total, view.byteLength, view.byteOffset].join(); }
function floats(memory) { const view = new Float64Array(memory); view[0] = 1.5; return [view.length, view[0], view.at(-1)].join(); }
function viewed(memory) { const view = new DataView(memory); view.setUint8(0, 7); return [view.byteLength, view.getUint8(0), view.getUint16(0, true)].join(); }
function tracked(bytes) { let total = 0; for (let i = 0; i < bytes.length; i++) total += bytes[i]; return bytes.length + ":" + total; }
const makers = {
  ordinary: () => new ArrayBuffer(16),
  resizable: () => new ArrayBuffer(16, { maxByteLength: 64 }),
  shared: () => new SharedArrayBuffer(16),
  growable: () => new SharedArrayBuffer(16, { maxByteLength: 64 }),
};
for (let round = 0; round < 3; round++) {
  for (const kind in makers) {
    const memory = fill(makers[kind]());
    const kept = new Uint8Array(memory), fixed = new Uint8Array(memory, 0, 8);
    const line = [sum(memory), words(memory), floats(memory), viewed(memory), tracked(kept), tracked(fixed)];
    if (kind === "resizable") { memory.resize(32); line.push(sum(fill(memory)), words(memory), tracked(kept), tracked(fixed)); memory.resize(8); line.push(sum(memory), tracked(kept), tracked(fixed)); memory.resize(4); line.push(tracked(kept), tracked(fixed)); }
    if (kind === "growable") { memory.grow(32); line.push(sum(fill(memory)), words(memory), tracked(kept), tracked(fixed)); }
    if (round === 2) console.log(kind, line.join(" "));
  }
}
