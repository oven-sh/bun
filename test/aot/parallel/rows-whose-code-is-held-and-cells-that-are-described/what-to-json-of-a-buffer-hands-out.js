const bytes = Buffer.from("ab");
const told = bytes.toJSON();
console.log(told.type, told.data.join(), Object.keys(told).join(), told.constructor === Object, Object.getPrototypeOf(told) === Object.prototype);
console.log(JSON.stringify(bytes), JSON.stringify({ bytes }), Buffer.prototype.toJSON.call([7, 8]).data.join());
console.log(bytes.offset === bytes.byteOffset, bytes.parent === bytes.buffer, bytes.parent instanceof ArrayBuffer, String(bytes.parent));
