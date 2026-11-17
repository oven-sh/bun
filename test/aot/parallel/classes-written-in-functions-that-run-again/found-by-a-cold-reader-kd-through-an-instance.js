"use strict";
function make() {
  return class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } };
}
const classes = [];
for (let each = 0; each < 3; each++) classes.push(make());
classes[1].prototype.extra = 7;
console.log("extra" in new classes[2](1), String(new classes[2](1).extra), new classes[1](1).extra);
