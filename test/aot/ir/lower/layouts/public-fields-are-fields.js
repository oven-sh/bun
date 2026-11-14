// RUN: link
// `__publicField(this, "x", 1)` as a statement of a constructor: what the bundler's helper defines is a field of the class, with or without a value. A helper of another text, a call under a condition and a name that is computed are none.
// CHECK: layout {{*}}name="Point" {{*}}key="x" declared={type=anything} flags=[IsRequired]}, {key="y" declared={type=anything} flags=[IsRequired]}
// CHECK: layout {{*}}name="Named" {{*}}key="z" declared={type=anything} flags=[IsRequired]}

// RUN(NONE): link
// NONE-NOT: layout {{*}}name="Other" {{*}}key="x"
// NONE-NOT: layout {{*}}name="Computed" {{*}}key="x"

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var other = (obj, key, value) => __defNormalProp(obj, key + "!", value);
export class Point {
  constructor() {
    __publicField(this, "x", 1);
    __publicField(this, "y");
  }
}
export class Named extends Point {
  constructor() {
    super(...arguments);
    __publicField(this, "z", this.x);
  }
}
export class Other {
  constructor() {
    other(this, "x", 1);
  }
}
export class Computed {
  constructor(name) {
    __publicField(this, name, 1);
  }
}
export const points = [new Point(), new Named(), new Other(), new Computed("x")];
