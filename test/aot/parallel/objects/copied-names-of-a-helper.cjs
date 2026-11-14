// A helper that copies into two classes: each gains the names of both calls.
class I { } class J { constructor() { this.j = 1; } }
function fill(o, s) { Object.assign(o, s); return o; }
var is = [], js = []; for (var i = 0; i < 40; i++) { is.push(fill(new I(), { x: i, y: 1 })); js.push(fill(new J(), { x: i * 0.5, w: "w" + i })); }
function sum(n) { var s = 0; for (var i = 0; i < n; i++) { s = s + is[i % 40].x + is[i % 40].y + js[i % 40].x + js[i % 40].j; } return s; }
var text = ""; for (var i = 0; i < 40; i++) text = (text + js[i].w + " " + js[i].x + " " + is[i].x + ",").slice(-200);
console.log(sum(40), sum(400), text);
