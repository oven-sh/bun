function find(source, length) {
  let found;
  for (const key in source) {
    const value = source[key];
    if (key.length === length) found = value;
  }
  return found;
}
function total(bytes) {
  let sum = 0;
  for (let index = 0; index < bytes.length; index++) sum += bytes[index] + 1;
  return sum;
}
const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
const made = find([JSON.parse("{}"), memory][1], 17).call(memory);
const bytes = new Uint8Array(made);
const before = total(bytes);
memory.grow(1);
console.log(`${before} ${total(bytes)} ${bytes.length} ${made.resizable}`);
