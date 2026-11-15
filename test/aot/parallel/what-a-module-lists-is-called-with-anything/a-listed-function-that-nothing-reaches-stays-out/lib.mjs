export function sum(a, b) {
  return a + b;
}
function first(a) {
  return [a].map(x => x + 1);
}
function second(a) {
  return first(a).concat(first(a));
}
function third(a) {
  return second(a).filter(x => x > 0);
}
export function spare(a) {
  return third(a).join();
}
