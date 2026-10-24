// A comparison with `null`, `undefined` or `void 0` separates the nullish members. A comparison with a local named `undefined` narrows by the type of that local.
declare const x: string | null | undefined;
if (x == null) {
  x;
} else {
  x;
}
if (x === undefined) {
  x;
} else {
  x;
}
if (x === void 0) {
  x;
} else {
  x;
}
function f(undefined: number, y: number | string) {
  if (y === undefined) {
    y;
  } else {
    y;
  }
}
