function bytes(data: DataView): number { return data.byteLength; }
const memory = new SharedArrayBuffer(8, { maxByteLength: 64 });
const data = new DataView(memory);
const part = new DataView(memory, 4);
console.log(bytes(data), bytes(part));
memory.grow(32);
console.log(bytes(data), bytes(part));
