// A reference used as a condition is tested for truth. The left operand of `??` is tested for presence, not for truth.
declare const x: { a: 1 } | undefined;
if (x) {
  x;
} else {
  x;
}
declare const y: "" | "a" | undefined;
y ||
  y;
y ??
  y;
