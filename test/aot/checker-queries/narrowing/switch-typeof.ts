// Each clause of `switch (typeof x)` narrows `x`, and `default` gets the remaining members.
declare const x: string | number | boolean;
switch (typeof x) {
  case "string":
    x;
    break;
  case "number":
    x;
    break;
  default:
    x;
}
