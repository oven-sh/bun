// What a constructor function makes outside a loop stands below its prototype of that minute, however the prototype came there.
function Class() {
  return function () {
    this.initialize.apply(this, arguments);
  };
}
var Shapes = {};
Shapes.Vector = Class();
Shapes.Vector.prototype = {
  initialize: function (x, y) {
    this.x = x ? x : 0;
    this.y = y ? y : 0;
  },
  kind: function () {
    return "first " + Object.keys(this).join();
  },
};
Shapes.Label = Class();
Shapes.Label.prototype = {
  initialize: function (text) {
    this.text = text;
  },
};
const operations = {
  add: function (left, right) {
    return new Shapes.Vector(left.x + right.x, left.y + right.y);
  },
  double: function (left) {
    return new Shapes.Vector(left.x * 2, left.y * 2);
  },
};
const one = new Shapes.Vector(1.5, 2.5);
const show = made => console.log(made.x, made.y, typeof made.kind === "function" ? made.kind() : made.kind, Object.getPrototypeOf(made) === Shapes.Vector.prototype);
const all = () => {
  for (const which of ["add", "double", "add"]) {
    try {
      show(operations[which](one, one));
    } catch (error) {
      console.log(error.constructor.name);
    }
  }
};
all();
const key = ["proto", "type"].join("");
const first = Shapes.Vector.prototype;
Reflect.set(Shapes.Vector, key, {
  initialize: function (x, y) {
    this.y = y;
    this.x = -x;
  },
  kind: function () {
    return "second " + Object.keys(this).join();
  },
});
all();
Reflect.set(Shapes.Vector, key, first);
all();
first[["init", "ialize"].join("")] = function (x) {
  this.z = x;
  this.x = x + 0.5;
};
all();
Object.defineProperty(first, ["x"].join(""), {
  configurable: true,
  set(value) {
    console.log("set", value);
  },
  get() {
    return "read";
  },
});
all();
Reflect.set(Shapes.Vector, key, 7);
all();
console.log(new Shapes.Label("a").text);
