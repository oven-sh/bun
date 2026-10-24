// `typeof x === "string"` narrows a union of primitives in both branches. After the statement `x` has its declared type.
declare const x: string | number;
if (typeof x === "string") {
  x;
} else {
  x;
}
x;
