const target = new Uint8Array([1, 2, 3, 4]);
const source = new Uint8Array(target.buffer, 0, 3);
const before = source[1];
target.set(source, 1);
console.log(before, source[1], source.join(), target.join());
