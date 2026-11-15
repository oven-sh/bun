// A value of a family is read under names that a class in the middle declares, a leaf, a class above the family, several classes one below another, a getter, a setter alone, a field, and nobody; and under a name that is stored beside the fields of one member, in front of the reads and behind them.
class Top { above() { return "top"; } both() { return "top-both"; } }
class Root extends Top { constructor() { super(); this.field = "field"; } rooted() { return "root"; } get got() { return "got by " + this.constructor.name; } set only(x) { this.seen = x; } }
class Left extends Root { left() { return "left"; } both() { return "left-both"; } }
class Right extends Root { right() { return "right"; } }
class Far extends Right { far() { return "far"; } both() { return "far-both"; } get got() { return "far got"; } }
class Leaf extends Far { leaf() { return "leaf"; } }
const all = [new Root(), new Left(), new Right(), new Far(), new Leaf()];
all[2].beside = "early";
function pick(i) { return all[i % all.length]; }
function say(x, it) { return typeof x === "function" ? x.call(it) : String(x); }
const lines = [];
for (let i = 0; i < all.length; i++) {
  const it = pick(i);
  lines.push([say(it.above, it), say(it.both, it), say(it.rooted, it), say(it.left, it), say(it.right, it), say(it.far, it), say(it.leaf, it), say(it.got, it), say(it.only, it), say(it.field, it), say(it.nobody, it), say(it.beside, it), say(it.late, it)].join());
}
all[4].late = "late";
for (let i = 0; i < all.length; i++) lines.push(say(pick(i).late, pick(i)) + "|" + say(pick(i).beside, pick(i)));
console.log(lines.join("\n"));
