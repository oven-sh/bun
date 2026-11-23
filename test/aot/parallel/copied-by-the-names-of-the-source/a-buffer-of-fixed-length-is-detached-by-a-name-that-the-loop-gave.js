function find(source, length) {
  let found;
  for (const key in source) {
    const value = source[key];
    if (key.length === length) found = value;
  }
  return found;
}
const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
const bytes = new Uint8Array(memory.buffer);
const before = bytes.length;
find([JSON.parse("{}"), memory][1], 17).call(memory);
console.log(`${before} ${bytes.length} ${bytes[0]}`);
