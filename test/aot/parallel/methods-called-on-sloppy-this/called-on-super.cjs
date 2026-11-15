var above = {
  m() {
    "use strict";
    return this === globalThis ? "global " + typeof this.process.finalization : typeof this;
  },
};
var below = {
  __proto__: above,
  m() {
    return super.m();
  },
  inside() {
    return (() => super.m())();
  },
};
console.log(below.m(), (0, below.m)(), below.inside.call(undefined), [1].map(below.inside)[0]);
