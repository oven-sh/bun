export function self() {
  return this
}
export const held = function () {
  return this
}
export function double(n) {
  return n * 2
}
export function twice(n) {
  return this.double(n)
}
