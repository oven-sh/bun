// Buffer.from and Buffer.prototype.toJSON are written in JavaScript. This program names them only through a pattern over a dynamic import of node:buffer.
const { Buffer: B } = await import("node:buffer");
console.log(B.from([1, 2]).toJSON());
