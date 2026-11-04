function Top(a) { this.a = a; }
function Middle(a, m) { this.m = m; }
function Low(a, m, l) { Middle.call(this, a, m); this.l = l; }
function peek(o) { return o.a; }
Object.setPrototypeOf(Middle.prototype, Top.prototype); Object.setPrototypeOf(Low.prototype, Middle.prototype);
function make(n) { let last; for (let i = 0; i < n; i++) last = new Low(i, 2, 3); return last; }
console.log(new Top(1).a, new Middle(1, 2).m);
console.log(String(peek(make(5))));
