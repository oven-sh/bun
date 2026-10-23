// `in` with a string literal narrows a union by the presence of the property.
declare const u: { a: number } | { b: string };
if ("a" in u) {
  u;
} else {
  u;
}
