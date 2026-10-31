// Buffer.prototype.writeInt32BE converts its first argument before it looks at its receiver: the error of the conversion arrives, however the method is called without a receiver.
const operand = {
  [Symbol.toPrimitive]() {
    throw new RangeError("converted");
  },
};
Promise.try(Buffer.prototype.writeInt32BE, operand).catch(e => console.log("try", e.name, e.message));
Promise.resolve(operand)
  .then(Buffer.prototype.writeInt32BE)
  .catch(e => console.log("then", e.name, e.message));
(async () => operand)()
  .then(Buffer.prototype.writeInt32BE)
  .catch(e => console.log("async", e.name, e.message));
try {
  Buffer.prototype.writeInt32BE.call(undefined, operand);
} catch (e) {
  console.log("call", e.name, e.message);
}
