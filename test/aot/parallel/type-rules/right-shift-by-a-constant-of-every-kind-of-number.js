// `x >> 28` lies in -8 .. 7 whatever number x is. What is made of the result goes by that range: a sum in 32 bits, an index without a test, a comparison that is decided.
const table = [];
for (let k = 0; k < 16; k++) table.push("t" + k);

function by28(x) {
  const high = x >> 28;
  return high + " " + table[high + 8] + " " + (high * 268435456 + 7) + " " + (high < -8 || high > 7) + " " + ((high + 2147483640) | 0);
}
function by1(x) {
  const half = x >> 1;
  return half + " " + (half + half) + " " + (half * 2 + 1073741824) + " " + (half >= -1073741824 && half <= 1073741823);
}
function by31(x) {
  const sign = x >> 31;
  return sign + " " + table[sign + 1] + " " + (sign === 0 || sign === -1) + " " + (sign ^ 5);
}
function by0(x) {
  return (x >> 0) + " " + ((x >> 0) + 1) + " " + ((x >> 0) - 1);
}
function by32(x) {
  return (x >> 32) + " " + ((x >> 32) + 1);
}
function by33(x) {
  return (x >> 33) + " " + ((x >> 33) * 4);
}
function byMinus4(x) {
  const high = x >> -4;
  return high + " " + table[high + 8];
}
function carries(x, y) {
  let carry = 0, sum = 0;
  for (let k = 0; k < 6; k++) {
    carry += x + y;
    sum = (sum + (carry & 0xfffffff)) | 0;
    carry >>= 28;
  }
  return carry + " " + sum;
}
function byAny(x, count) {
  return (x >> count) + " " + ((x >> count) + 1);
}

const shifts = [by28, by1, by31, by0, by32, by33, byMinus4];
let warm = 0;
for (let turn = 0; turn < 4000; turn++) {
  for (const shift of shifts) warm += shift((turn * 2654435761) | 0).length;
  warm += carries(turn * 65537, 268435455 - turn).length + byAny(turn * 4099, turn & 31).length;
}
console.log(warm);

const numbers = [
  0, -0, 1, -1, 7, -8, 0.5, -0.5, 1.9, -1.9, 268435455, 268435456, -268435456, -268435457,
  1073741823, 1073741824, -1073741824, -1073741825, 2147483647, 2147483648, 2147483649, -2147483648, -2147483649,
  4294967295, 4294967296, 4294967297, -4294967295, -4294967296, 6442450944, 8589934591.75, -6442450944.5,
  9007199254740991, 9007199254740992, -9007199254740991, 1e21, -1e21, 1.7976931348623157e308, 5e-324,
  NaN, Infinity, -Infinity,
];
const others = ["12", "-2147483649", "4294967297.5", "", "x", null, undefined, true, false, [], [3000000000], {}, { valueOf() { return 3221225472; } }];
for (const shift of shifts) {
  console.log(shift.name, numbers.map(shift).join(" | "));
  console.log(shift.name, others.map(shift).join(" | "));
}
for (const x of numbers) console.log("carries", x, carries(x, 268435455), carries(268435455, x), carries(x, x));
for (const count of [0, 1, 28, 31, 32, 33, 63, 64, -1, -4, -32, 2.9, NaN, Infinity, 4294967296 + 28, "28", null, undefined])
  console.log("byAny", String(count), numbers.map(x => byAny(x, count)).join(" | "));
for (const shift of shifts) {
  for (const x of [5n, Symbol("x")]) {
    try {
      console.log(shift.name, shift(x));
    } catch (error) {
      console.log(shift.name, error.constructor.name);
    }
  }
}
