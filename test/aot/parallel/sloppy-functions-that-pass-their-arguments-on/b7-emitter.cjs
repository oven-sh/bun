function E() { this.l = []; } E.prototype.on = function (f) { this.l.push(f); return this; }; E.prototype.emit = function () { for (var i = 0; i < this.l.length; i++) this.l[i].apply(this, arguments); return true; }; var tot = 0, e = new E().on(function (x) { tot = (tot + x) % 1000; }); function h(x) { e.emit(x); return tot; }
function f(t) { var s = 0; for (var i = 0; i < 64; i++) s += h(i + t); return s; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
