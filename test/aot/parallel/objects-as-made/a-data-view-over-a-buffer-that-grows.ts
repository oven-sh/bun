function bytes(data: DataView): number { return data.byteLength; }
function first(data: DataView): number { return data.getUint8(0) + data.byteOffset; }
const buffer = new ArrayBuffer(4, { maxByteLength: 16 });
const data = new DataView(buffer);
data.setUint8(0, 7);
console.log(bytes(data), first(data));
buffer.resize(16);
console.log(bytes(data), first(data));
buffer.resize(2);
console.log(bytes(data), first(data));
