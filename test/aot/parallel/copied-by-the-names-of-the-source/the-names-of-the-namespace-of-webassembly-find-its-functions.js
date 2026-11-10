function copy(target, source) {
  for (const key in source) target[key] = source[key];
  return target;
}
const copied = copy({}, [JSON.parse("{}"), WebAssembly][1]);
console.log(`${Object.keys(copied).sort().join()} ${copied.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))}`);
