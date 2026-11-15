export function step(k) {
  this.x += k;
  return this;
}
export function twice() {
  return this.x * 2;
}
export const next = function () {
  return this.link ?? null;
};
export let label = function () {
  return "label " + this.x;
};
export function relabel(f) {
  label = f;
}
export { hidden as shown };
function hidden() {
  return this === undefined ? "none" : "shown " + this.x;
}
