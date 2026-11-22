// nothing calls makeShelf(): no closure of Inner is ever made, and its methods are asked for all the same
const shelf = {
  size() { return this.v + 1; },
};
export const isShelf = x => shelf.isPrototypeOf(x);
export function makeShelf() {
  function Inner(v) { this.v = v; }
  Inner.prototype = shelf;
  return Inner;
}

// nothing reads Lamp: the call and the literal go
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

// nothing calls the function that stores the prototype
const cup = {
  fill() { return "cup " + this.v; },
};
export function Cup(v) { this.v = v; }
function storeCup() { Cup.prototype = cup; }

// a branch that is never taken stores it
const box = {
  open() { return "box " + this.v; },
};
export function Box(v) { this.v = v; }
if (false) {
  Box.prototype = box;
}

// a function that is made beside one that nothing makes, both below one literal
const tray = {
  carry() { return "tray " + this.v; },
};
export const Tray = (function () {
  function Made(v) { this.v = v; }
  Made.prototype = tray;
  return Made;
})();
export const Unread = /*#__PURE__*/ (() => {
  function Inner(v) { this.w = v; }
  Inner.prototype = tray;
  return Inner;
})();
