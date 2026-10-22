// A call to a user-defined type guard narrows its argument in both branches.
function isString(v: unknown): v is string { return typeof v === "string"; }
declare const x: string | number;
if (isString(x)) {
  x;
} else {
  x;
}
