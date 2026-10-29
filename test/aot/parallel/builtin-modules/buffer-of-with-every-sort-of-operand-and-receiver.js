// Buffer.of makes a Buffer of its operands whatever its receiver is: it converts each operand in order, ends at the first conversion that throws, and constructs nothing through the receiver.
const show = made => `${made instanceof Buffer} ${Object.getPrototypeOf(made) === Buffer.prototype} ${made.length} ${made.toString("hex")}`;
const ran = [];
const counted = (name, value) => ({ valueOf() { ran.push(name); return value; } });
console.log(show(Buffer.of()), show(Buffer.of(1, 2, 3)), show(Buffer.of(1.9, -1, 300, NaN, "16", "0x10", true, null, undefined)));
const hinted = { [Symbol.toPrimitive](hint) { ran.push(hint); return 3; } };
const spelled = { valueOf: undefined, toString() { ran.push("toString"); return "4"; } };
console.log(show(Buffer.of(counted("a", 1), counted("b", 2), hinted, spelled)), ran.join());
const { of } = Buffer;
console.log(show(of(5, 6)), show(Buffer.of.call(Uint8Array, 7)), show(Buffer.of.call(null, 8)), show(Reflect.apply(Buffer.of, undefined, [9])));
console.log([65, 66].map(Buffer.of).map(show).join(", "), Object.hasOwn(Buffer, "of"), Buffer.of === Uint8Array.of, Buffer.of.length, Buffer.of.name);
let constructed = 0;
class Packet extends Buffer { constructor(...operands) { constructed++; super(...operands); } }
console.log(show(Packet.of(1, 2)), Packet.of === Buffer.of, constructed);
for (const refused of [Symbol("s"), 1n, { valueOf() { throw new RangeError("thrown by valueOf"); } }]) {
  ran.length = 0;
  try { console.log(show(Buffer.of(counted("before", 1), refused, counted("after", 2)))); } catch (error) { console.log(error.name, ran.join()); }
}
function total() {
  let sum = 0;
  for (let i = 0; i < 300; i++) { const made = Buffer.of(i, i >> 1, counted("in the loop", i)); sum += made[0] + made[1] + made[2] + made.length; }
  return sum;
}
ran.length = 0;
console.log(total(), ran.length, total(), ran.length);
