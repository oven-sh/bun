// Flags: --minify-syntax
// Reference: bun build --compile
// Under --minify-syntax `bun build` writes a constant in place of its name and computes with `Infinity`, as `bun run` does: what it computes is the one NaN. Arguments still run.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = (value: number) => {
  number[0] = value;
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("")
    .slice(0, 4);
};
const zero = 0,
  endless = Infinity,
  less = -1,
  half = 0.5,
  third = 1 / 3,
  eight = -8,
  none = NaN,
  nothing = undefined;
const late = Date.now() > 0 ? 1 : 2;
function divide(a: number, b: number) {
  return a / b;
}
function subtract(a: number, b: number) {
  return a - b;
}
function raise(base: number, exponent: number) {
  return base ** exponent;
}
function negate(value: any) {
  return -value;
}
console.log("powers", text(less ** half), text(eight ** third), text(less ** 1.5), text((-4) ** half));
console.log(
  "sums",
  text(zero / zero + late),
  text((zero / zero) * late),
  text(endless - endless - late),
  text((endless * zero) / late),
  text(late + zero / zero),
);
console.log("negated", text(-(nothing as any)), text(-none), text(-(zero / zero)));
console.log("names", text(Infinity - Infinity), text(Infinity * 0), text(-(Infinity - Infinity)));
console.log("written", text(0 / 0), text(-(0 / 0)), text((-1) ** 0.5), text((-8) ** (1 / 3)), text(-undefined!));
console.log(
  "arguments",
  text(divide(0, 0)),
  text(subtract(Infinity, Infinity)),
  text(raise(-8, 1 / 3)),
  text(negate(undefined)),
  text(negate(NaN)),
);
console.log("brought", text(none + 1), text(none * less), text(2 ** none), text(less ** endless), text(none ** 3));
