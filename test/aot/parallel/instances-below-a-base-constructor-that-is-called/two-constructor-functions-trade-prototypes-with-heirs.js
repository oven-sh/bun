// Two constructor functions, one with more fields than the classes and one with fewer, are given their own prototypes and those of two classes in turn, 400 times, while the classes are made through a called base constructor: each object stays of its own function.
"use strict";
const unseen = (x) => [x][JSON.parse("0")];
class Base { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + 1 + work; } }
class First extends Base { constructor(n) { super(n); this.mark = n + 2; } }
class Second extends Base { constructor(n) { super(n); this.mark = n + 3; this.more = n; } }
function Wide(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.a = n; this.b = "b" + n; this.c = n / 4; this.d = [n]; this.e = n + 4; this.f = n + 5; this.g = n + 6; this.h = n + 7; this.i = n + 8; this.j = n + 9; this.k = n + 10; this.l = n + 11 + work; }
function Thin(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.z = n + work; }
const kept = [Wide.prototype, Thin.prototype, First.prototype, Second.prototype];
function heirs(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new First(n + work).mark + new Second(n).mark; }
function both(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [new Wide(n + work), new Thin(n)]; }
let text = "";
for (let turn = 0; turn < 400; turn++) {
  const at = unseen(turn);
  Wide.prototype = kept[at % 4];
  Thin.prototype = kept[(at + 1 + (at >> 2)) % 4];
  const marks = heirs(turn);
  const [wide, thin] = unseen(both(turn));
  const more = heirs(turn);
  if (turn % 50 === 7 || turn < 5)
    text += Object.keys(wide).join("") + ":" + (wide.a + wide.e + wide.f + wide.g + wide.h + wide.i + wide.j + wide.k + wide.l) + wide.b + wide.c + wide.d[0] + ":" + Object.keys(thin).join("") + thin.z + ":" + (wide instanceof First) + (thin instanceof Second) + (Object.getPrototypeOf(wide) === kept[at % 4]) + ":" + (marks + more) + " ";
}
console.log(text);
