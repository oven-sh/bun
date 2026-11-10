const from = Buffer.from;
console.log(typeof from, from.name, typeof Buffer.isBuffer, Buffer.isBuffer(from("ab")), from("ab").toJSON().data.length);
