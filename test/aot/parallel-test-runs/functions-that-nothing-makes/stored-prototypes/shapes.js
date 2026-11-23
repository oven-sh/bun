const shelf = {
  size() { return this.v + 1; },
};
export const isShelf = x => shelf.isPrototypeOf(x);
export function makeShelf() {
  function Inner(v) { this.v = v; }
  Inner.prototype = shelf;
  return Inner;
}
const lamp = {
  get twice() { return this.v * 2; },
};
export const Lamp = /*#__PURE__*/ (function () {
  function Inner(v) { this.v = v; }
  Inner.prototype = lamp;
  return Inner;
})();
const plain = {
  kind() { return "plain " + this.v; },
};
export const makePlain = v => Object.assign(Object.create(plain), { v });
