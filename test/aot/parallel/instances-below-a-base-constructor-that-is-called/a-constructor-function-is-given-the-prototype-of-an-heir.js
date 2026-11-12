// A constructor function whose site has met its own prototype is then given the prototype object of a class that was made through a called base constructor: its objects stay its own, with their eight fields, whatever the run time remembers of that prototype.
"use strict";
const unseen = (x) => [x][JSON.parse("0")];
class Base { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + 1 + work; } }
class First extends Base { constructor(n) { super(n); this.mark = n + 2; } }
class Second extends Base { constructor(n) { super(n); this.mark = n + 3; this.more = n; } }
function Plain(n) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  this.a = n; this.b = n + 1; this.c = n + 2; this.d = n + 3; this.e = n + 4; this.f = n + 5; this.g = n + 6; this.h = n + 7 + work;
}
const shared = First.prototype;
function heirs(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new First(n + work).mark + new Second(n).mark; }
function plain(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Plain(n + work); }
let text = "";
for (let turn = 0; turn < 6; turn++) {
    if (turn === 3) Plain.prototype = shared;
  const marks = heirs(turn);
  const made = unseen(plain(turn));
  const more = heirs(turn);
  text += Object.keys(made).join("") + ":" + (made.a + made.b + made.c + made.d + made.e + made.f + made.g + made.h) + ":" + (made instanceof First) + ":" + (marks + more) + " ";
}
console.log(text);
