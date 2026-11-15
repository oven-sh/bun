// A class whose base returns its argument lays its field on objects of five other classes, one of which declares a getter under that name.
class Identity { constructor(o) { return o; } }
class Stamp extends Identity { tag = JSON.parse('"own"'); }
class P { get tag() { return "getter"; } }
class Q { q = 1; } class R { r = 1; } class S { s = 1; } class T { t = 1; }
const p = new P();
for (const o of [p, new Q(), new R(), new S(), new T()]) new Stamp(o);
const read = o => o.tag;
console.log(read(p));
