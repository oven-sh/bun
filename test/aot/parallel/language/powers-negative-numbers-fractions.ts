// Raises negative numbers to exponents that are fractions, and other bases to exponents that leave no number, and prints the bytes of the results. Where a function or an assignment raises to one half, it prints them without the sign.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = (value: number) => {
  number[0] = value;
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("")
    .slice(0, 4);
};
const withoutSign = (value: number) => (parseInt(text(value), 16) & 0x7fff).toString(16);
const less = -1,
  half = 0.5,
  third = 1 / 3,
  eight = -8;
function raise(base: number, exponent: number) {
  return base ** exponent;
}
function raiseByMath(base: number, exponent: number) {
  return Math.pow(base, exponent);
}
console.log(
  "literals",
  text((-1) ** 0.5),
  text((-8) ** (1 / 3)),
  text((-1.5) ** 2.5),
  text((-2) ** -0.5),
  text((-5e-324) ** 1.5),
  text((-1e308) ** 0.1),
);
console.log("constants", text(less ** half), text(eight ** third), text(less ** 1.5), text((-4) ** half));
console.log(
  "arguments",
  withoutSign(raise(-1, 0.5)),
  text(raise(-8, 1 / 3)),
  withoutSign(raise(less, half)),
  withoutSign(raiseByMath(-1, 0.5)),
  text(raiseByMath(eight, third)),
);
console.log(
  "other bases",
  text(NaN ** 2),
  text((-NaN) ** 3),
  text(2 ** NaN),
  text((-0) ** 0.5),
  text((-Infinity) ** 0.5),
  text((-1) ** Infinity),
  text(1 ** -Infinity),
  text((-8) ** 3),
  text((-8) ** -1),
  text(NaN ** 0),
);
let power = -1,
  other = -8;
power **= 0.5;
other **= 1 / 3;
console.log("an assignment", withoutSign(power), text(other));
enum Power {
  Root = (-1) ** 0.5,
  Next = Root + 1,
  Whole = (-2) ** 3,
}
console.log("an enum", text(Power.Root), text(Power.Next), text(Power.Whole), Power[Power.Whole], String(Power.Root));
class Holder {
  static root = (-1) ** 0.5;
  root = (-4) ** 0.5;
}
console.log("fields", text(Holder.root), text(new Holder().root));
function defaults(root = (-1) ** 1.5) {
  return text(root);
}
console.log("a default", defaults());
console.log(
  "tests",
  (-1) ** 0.5 === (-1) ** 0.5,
  Number.isNaN((-1) ** 0.5),
  Object.is((-1) ** 0.5, NaN),
  [(-1) ** 0.5].includes(NaN),
  new Set([(-1) ** 0.5, NaN, raise(-1, 0.5)]).size,
);
