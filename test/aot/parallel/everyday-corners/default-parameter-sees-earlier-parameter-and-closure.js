// Default parameter sees earlier parameter and closure: compiled answers as plain.
function f(a, b = () => a, c = b()) {
  a = "changed";
  return [a, b(), c].join();
}
console.log(
  f(1),
  f(1, () => 2),
  f(undefined, undefined, 3),
);
