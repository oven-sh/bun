// Reads past the end: compiled answers as plain.
function at(a, i) {
  return a[i];
}
const l = [1, 2, 3];
console.log(
  [
    at(l, 0),
    at(l, 3),
    at(l, -1),
    at(l, 1.5),
    at(l, "1"),
    at(l, "01"),
    at(l, NaN),
    at(l, 4294967295),
    at("abc", 1),
    at("abc", 3),
    at({ 1: "o" }, 1),
  ]
    .map(String)
    .join(),
);
