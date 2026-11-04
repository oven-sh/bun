// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// What TypeScript writes for `class Mine extends Error {}` at ES5.
var __extends = function (d, b) {
  Object.setPrototypeOf(d, b);
  function __() {
    this.constructor = d;
  }
  d.prototype = ((__.prototype = b.prototype), new __());
};
var Mine = (function (_super) {
  __extends(Mine, _super);
  function Mine() {
    return (_super !== null && _super.apply(this, arguments)) || this;
  }
  return Mine;
})(Error);
var error = new Mine("a");
console.log(typeof error.stack, error instanceof Error, error.message);
