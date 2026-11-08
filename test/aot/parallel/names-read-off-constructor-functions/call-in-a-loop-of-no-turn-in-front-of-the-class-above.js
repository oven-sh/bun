function early(k) { let s = 0; for (let i = 0; i < k; i++) s += new Below(i).a; return s; }
console.log(early(JSON.parse("0")));
var Base = function Base(a) { this.a = a + 1; };
var Below = function Below(a) { Base.call(this, a); };
console.log(early(JSON.parse("3")));
