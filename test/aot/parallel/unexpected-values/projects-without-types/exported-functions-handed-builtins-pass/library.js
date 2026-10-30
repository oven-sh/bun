export const log = [];
export function scaled(n, factor = 2) {
  return n * factor;
}
export function labelled(n, label) {
  return label === undefined ? "item " + n : label + " " + n;
}
export function sizeOf(list) {
  return list.length;
}
export function noted(value, extra) {
  log.push(typeof value + "/" + typeof extra + "/" + arguments.length);
  return value;
}
export function total(sum, n) {
  return sum + n;
}
export function parsed(text, base) {
  return parseInt(text, base);
}
