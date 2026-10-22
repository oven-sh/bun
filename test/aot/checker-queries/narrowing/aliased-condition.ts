// A condition kept in a `const` narrows where the constant is tested.
declare const x: string | number;
const isText = typeof x === "string";
if (isText) {
  x;
} else {
  x;
}
