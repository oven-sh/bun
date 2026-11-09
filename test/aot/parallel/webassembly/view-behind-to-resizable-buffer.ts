// A view behind toResizableBuffer() answers as bun run.
function look(bytes: Uint8Array, memory: WebAssembly.Memory, change: boolean): string { const before = bytes.length + " " + bytes[0]; if (change) memory.toResizableBuffer(); return before + " | " + bytes.length + " " + bytes[0]; }
for (let turn = 0; turn < 64; turn++) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
  const bytes = new Uint8Array(memory.buffer);
  bytes[0] = 9; bytes[7] = 8;
  const said = look(bytes, memory, turn >= 60);
  if (turn === 59 || turn === 63) console.log(said);
}
