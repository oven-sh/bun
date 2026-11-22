// STATISTIC: ConstantsCutToInt32 >= 12
"use strict";
class Key {
  constructor(bits) {
    this.bits = bits;
    this.parts = [0, 0, 0];
  }
}
function split(key, value) {
  key.bits = value;
  key.parts[0] = ((key.bits & 4278190080) >> 24) & 255;
  key.parts[1] = (key.bits & 16711680) >> 16;
  key.parts[2] = (key.bits ^ 0xffffffff) >>> 24;
  return (key.bits | 0x80000000) + (4294967295 >>> (value & 7)) + (2147483648 >> (value & 3)) + (key.bits << 33);
}
function odd(value) {
  return [value & 1e12, value | -4294967297, value ^ 0.5, value & NaN, value >>> 4294967297, value << -1, 1e300 & value, Infinity | value].join("/");
}
function big(value) {
  try {
    return String(value & 4278190080);
  } catch (error) {
    return error.constructor.name;
  }
}
const key = new Key(0);
let sum = 0;
for (let turn = 0; turn < 3000; turn++) sum += split(key, turn * 16843009.5);
console.log(sum, key.parts.join(), odd(5), odd(-1.5), odd(4294967295), odd(1e20));
console.log(big(7n), big("4278190081"), big(undefined), big({ valueOf: () => 3e9 }), big(Symbol.iterator));
