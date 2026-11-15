// Constructors that hand their arguments on to what fills the object, where `this.constructor` is the function itself, and what keeps them from it.
const lines = [];
const show = v => lines.push([typeof v.x, String(v.x), typeof v.y, String(v.y), String(v.x * 2 + v.y * 0.5), v.x === undefined, Object.keys(v).join("|")].join());
(function () {
  function Vec() {
    Vec.fill.apply(this, arguments);
    if (this.constructor === Vec) this.init.apply(this, arguments);
  }
  Vec.fill = function () {};
  Vec.prototype.init = function (x, y) {
    if (x === undefined) x = 0;
    if (y === undefined) y = 0;
    this.x = x;
    this.y = y;
  };
  Vec.prototype.add = function (v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  };
  function Part() {
    Part.fill.call(this, 1);
    Part === this.constructor && this.init(...arguments);
  }
  Part.fill = function (z) {
    this.z = z;
  };
  Part.prototype.init = function (x, y) {
    this.set.apply(this, [x, y]);
  };
  Part.prototype.set = function (x, y) {
    this.x = x;
    this.y = y;
  };
  function sum(list) {
    let s = 0;
    for (let i = 0; i < list.length; i++) s += list[i].x * list[i].y;
    return s;
  }
  const list = [];
  for (let i = 0; i < 40; i++) list.push(new Vec(i * 0.5, i).add(new Vec(1, 2)));
  lines.push(String(sum(list)));
  for (const v of [new Vec(1, 2), new Vec(), new Vec(0.5), new Vec("t", null), new Part(1, 2), new Part(1.5)]) show(v);
  function Heir() {
    Vec.apply(this, arguments);
  }
  Heir.prototype = Object.create(Vec.prototype);
  Heir.prototype.constructor = Heir;
  show(new Heir(3, 4));
  show(Reflect.construct(Vec, [5, 6], Heir));
  show(new (class extends Vec {})(7, 8));
})();
function broken(change, args) {
  function Vec() {
    Vec.fill.apply(this, arguments);
    if (this.constructor === Vec) this.init.apply(this, arguments);
  }
  Vec.fill = function () {};
  Vec.prototype.init = function (x, y) {
    this.x = x;
    this.y = y;
  };
  show(new Vec(1, 2));
  change(Vec);
  show(new Vec(...args));
}
broken(Vec => delete Vec.prototype.constructor, [1, 2]);
broken(Vec => (Vec.prototype.constructor = Object), [1, 2]);
broken(Vec => (Vec.prototype = { init: Vec.prototype.init }), [1, 2]);
broken(Vec => (Vec.prototype.init = function (x) { this.y = x; }), [0.5]);
broken(Vec => Object.defineProperty(Vec.prototype, "constructor", { get: () => Math.max }), [1, 2]);
(function () {
  const held = [];
  function Late() {
    held.push(this);
    if (this.constructor === Late) this.x = 1.5;
  }
  function Own() {
    this.constructor = Late;
    if (this.constructor === Own) this.x = 2.5;
  }
  function Deleted() {
    if (this.constructor === Deleted) this.x = 3.5;
  }
  delete Deleted.prototype.constructor;
  function Literal() {
    if (this.constructor === Literal) this.x = 4.5;
  }
  Literal.prototype = { y: 1 };
  function Stored() {
    if (this.constructor === Stored) this.x = 5.5;
  }
  Stored.prototype.constructor = Late;
  function Thrown(y) {
    if (this.constructor !== Thrown) return;
    if (y > 1) throw "thrown";
    this.x = y;
  }
  for (const v of [new Late(), new Own(), new Deleted(), new Literal(), new Stored(), new Thrown(1)]) show(v);
  try {
    show(new Thrown(2));
  } catch (e) {
    lines.push(e);
  }
  held[0].constructor = Own;
  show(held[0]);
})();
(function () {
  function Odd() {
    Odd.fill.call(this);
    if (this.constructor === Odd) this.init.apply(this, arguments);
  }
  Odd.fill = function () {};
  Odd.prototype.init = function (x) {
    this.x = x;
  };
  Odd.prototype.init.apply = Odd.prototype.init;
  function Other() {
    if (this.constructor === Other) Other.fill.call(this, 1.5);
  }
  Other.fill = function (x) {
    if (this) this.x = x;
  };
  Other.fill.call = Other.fill;
  show(new Odd(1.5));
  show(new Other());
})();
console.log(lines.join("\n"));
