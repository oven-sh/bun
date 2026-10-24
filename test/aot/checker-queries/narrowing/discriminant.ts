// A comparison of a property that has literal types narrows a union. A property of type `string` leaves its object as declared.
type S = { kind: "a"; x: number } | { kind: "b"; y: string };
declare const s: S;
if (s.kind === "a") {
  s;
} else {
  s;
}
declare const t: { kind: string };
if (t.kind === "a") {
  t;
} else {
  t;
}
