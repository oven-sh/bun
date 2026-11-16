// The form stands in a function: every call makes an object of its own, and one of them is changed through what the call answers.
function make(changes) {
  var Sides;
  (function (Sides) {
      Sides[Sides["Left"] = 0] = "Left";
      Sides[Sides["Right"] = 1] = "Right";
  })(Sides || (Sides = {}));
  return c => {
    switch (c) {
      case Sides.Left: return "left";
      case Sides.Right: return "right";
      default: return "other";
    }
  };
}
const side = make();
console.log(side(0), side(1), side(2));
function makeOpen() {
  var Sides;
  (function (Sides) {
      Sides[Sides["Left"] = 0] = "Left";
      Sides[Sides["Right"] = 1] = "Right";
  })(Sides || (Sides = {}));
  return [c => {
    switch (c) {
      case Sides.Left: return "left";
      case Sides.Right: return "right";
      default: return "other";
    }
  }, Sides];
}
const [open, sides] = makeOpen();
console.log(open(0), open(1), open(2));
sides.Right = 2;
console.log(open(0), open(1), open(2));
