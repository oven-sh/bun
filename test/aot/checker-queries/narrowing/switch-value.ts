// Each clause of a `switch` over a union of literals narrows the subject, and `default` gets the remaining members.
declare const v: "a" | "b" | "c";
switch (v) {
  case "a":
    v;
    break;
  case "b":
    v;
    break;
  default:
    v;
}
