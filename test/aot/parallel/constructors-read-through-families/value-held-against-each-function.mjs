const zero = 0;
function Base(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; }
function Sub(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; this.s = work; }
function Sub2(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; this.t = work; }
Sub.prototype = Object.create(Base.prototype);
Sub2.prototype = Object.create(Sub.prototype);
function maker(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.constructor; }
function markIt(C) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return (C === Base ? 1 : 0) + (C === Sub ? 10 : 0) + (C === Sub2 ? 100 : 0); }
let sum = 0;
for (let i = 0; i < 300; i++) sum = sum + markIt(maker(i & 1 ? new Sub(i) : new Sub2(i)));
console.log(sum);
