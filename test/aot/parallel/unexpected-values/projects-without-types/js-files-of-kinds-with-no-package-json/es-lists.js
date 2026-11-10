export function make() {
  return [1, 2, 3];
}
export function size(list) {
  return list.length;
}
export const mode = (function () {
  return this === undefined ? "strict" : "sloppy";
})();
