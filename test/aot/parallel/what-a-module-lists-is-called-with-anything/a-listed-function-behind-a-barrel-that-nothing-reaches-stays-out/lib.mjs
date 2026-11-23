export function sum(a, b) {
  return a + b;
}
function first(a) {
  return [a].map(x => x + 1);
}
function second(a) {
  return first(a).concat(first(a));
}
export function spare(a) {
  return second(a).join();
}
