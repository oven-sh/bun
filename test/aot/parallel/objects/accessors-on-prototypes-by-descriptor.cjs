"use strict";
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));

function clamp(value, low, high) {
  if (value === undefined) value = 0;
  return value < low ? low : value > high ? high : value;
}
function Color(red) {
  this._red = red;
  this.x = 0;
}
Object.defineProperty(Color.prototype, "red", {
  enumerable: false,
  configurable: true,
  set: function (value) {
    this._red = clamp(value, 0, 3);
  },
  get: function () {
    return this._red;
  },
});
Object.defineProperty(Color.prototype, "label", {
  get() {
    return typeof this + ":" + this._red;
  },
});
Color.prototype.move = function (by) {
  this.x = clamp(this.x + by, -10, 10);
  return this.x;
};
function Shade(red) {
  Color.call(this, red);
}
Shade.prototype = Object.create(Color.prototype);
Shade.prototype.constructor = Shade;

const run = count => {
  const color = new Color(1);
  const shade = new Shade(2);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    color.red = i * 0.25;
    shade.red = i & 1 ? i : -0.5;
    sum += color.red + shade.red + color.move(i & 1 ? 0.5 : -0.25);
  }
  return sum;
};
tell(run(10), run(200), new Color(5).label, new Shade("s").label);

const color = new Color(2);
color.red = "late";
tell(color.red, color._red);
color.red = { valueOf: () => 2.5 };
tell(typeof color.red, color.red + 0);
try {
  color.label = 1;
} catch (error) {
  tell(error.constructor.name);
}

const { get, set } = Object.getOwnPropertyDescriptor(Color.prototype, "red");
tell(get.call({ _red: "other" }), get.name, set.length, typeof get.prototype, new get() instanceof get);
const bare = {};
set.call(bare, 9);
set.call(bare, 2, 7);
tell(Object.keys(bare).join(), bare._red, run(10));
try {
  set(1);
} catch (error) {
  tell(error.constructor.name);
}

const seen = [];
const watched = new Proxy(new Color(1), {
  get(target, key, receiver) {
    seen.push(String(key));
    return Reflect.get(target, key, receiver);
  },
});
watched.red = 2;
tell(watched.red, seen.join(), Reflect.get(Color.prototype, "red", { _red: -0 }) === 0, Reflect.set(Color.prototype, "red", 8, bare), bare._red);

const below = Object.create(color);
below.red = 1;
tell(Object.keys(below).join(), below.red, color._red);
for (const key of ["red", "label", "x"]) tell(key, text(color[key]), key in color, Object.hasOwn(color, key));
function text(value) {
  return typeof value === "object" ? "object" : value;
}
tell(JSON.stringify(new Color(1)), JSON.stringify(Object.assign(new Color(1), { red: 7 })));

Object.defineProperty(Shade.prototype, "red", {
  get: () => "shade",
  set(value) {
    super.red = value;
    this.kept = value;
  },
});
const shade = new Shade(1);
shade.red = 1.5;
tell(shade.red, shade._red, shade.kept);

Object.defineProperty(Color.prototype, "red", { get: undefined, set: undefined });
tell(color.red, new Color(4).red, shade.red);
delete Color.prototype.red;
color.red = 12;
tell(color.red, Object.keys(color).join());
console.log(lines.join("\n"));
