"use strict";
const unseen = (0, eval)("(value) => value");
class Ground { constructor() { this.size = 1; } }
const mix = (Base) => class extends Base { constructor() { super(); } };
const Top = unseen(Ground);
const classes = [mix(Top), mix(Top), mix(Top)];
classes[1].prototype.extra = 7;
console.log(Object.getOwnPropertyNames(classes[2].prototype).join(), String(classes[2].prototype.extra), new classes[2]().size);
