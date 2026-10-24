// Each clause of a `switch` over a discriminant property narrows the object.
type S = { kind: "a"; x: number } | { kind: "b"; y: string };
declare const s: S;
switch (s.kind) {
  case "a":
    s;
    break;
  case "b":
    s;
    break;
}
