export function* steps() {
  yield 1;
}
export function plain() {
  return 1;
}
export function storedOn(callee) {
  return callee.stored;
}
