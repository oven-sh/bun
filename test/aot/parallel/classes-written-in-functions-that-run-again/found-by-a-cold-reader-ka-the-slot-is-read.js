"use strict";
function make() {
  return class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } };
}
const classes = [];
for (let each = 0; each < 3; each++) classes.push(make());
classes[1].prototype.extra = 7;
console.log(Object.getOwnPropertyNames(classes[2].prototype).join());
console.log(String(classes[2].prototype.extra));
