function copy(target, source) {
  for (const key in source) target[key] = source[key];
  return target;
}
const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
const copied = copy({}, [JSON.parse("{}"), memory][1]);
console.log(`${Object.keys(copied).sort().join()} ${copied.grow.call(memory, 1)} ${memory.buffer.byteLength}`);
