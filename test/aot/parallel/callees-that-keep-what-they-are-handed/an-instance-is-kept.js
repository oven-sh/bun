class Kettle { constructor(lid) { this.lid = lid; this.spout = [lid]; } pour() { return this.lid + this.spout.length; } }
const shelf = [];
function keep(o) { for (let k = 0; k < 1; k++) shelf.push(o); }
function make(i) { const o = new Kettle(i); keep(o); return o.pour(); }
console.log(make(1), make(2), shelf.map(k => k.pour()).join());
