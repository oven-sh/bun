function harden() { Object.freeze(Object.prototype); }
const first = {};
first.toString = 0;
harden();
const second = {};
second.toString = 0;
console.log(typeof first.toString, typeof second.toString);
