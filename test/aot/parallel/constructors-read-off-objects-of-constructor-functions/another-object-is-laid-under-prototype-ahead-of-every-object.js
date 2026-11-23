// One store lays another object under `prototype` of a constructor function ahead of its first object, and whatever could tell.
function show(row) { try { console.log(row().join(" ")); } catch (e) { console.log("threw", e && e.name, e && e.message); } }
function sum(make, n) { var t = 0; for (var i = 0; i < n; i++) { var o = make(i); var v = o.get ? o.get() : -5; t += typeof v === "number" ? v : 1000; } return t; }

function Plain(x) { this.x = x; }
Plain.prototype = { get: function () { return this.x; } };
show(function () { return ["plain", sum(function (i) { return new Plain(i); }, 200), new Plain(1) instanceof Plain, Object.getPrototypeOf(new Plain(1)) === Plain.prototype, new Plain(1).constructor === Object]; });

// A guard begins the class ahead of the store.
function Early(x) { this.x = x; }
Early.prototype.get = function () { return -1; };
function callEarly(n) { var t = 0; for (var i = 0; i < n; i++) t += Early.prototype.get.call({ x: i }); return t; }
show(function () { return ["early", callEarly(100)]; });
Early.prototype = { get: function () { return this.x; } };
show(function () { return ["early", sum(function (i) { return new Early(i); }, 200), new Early(1) instanceof Early, callEarly(100)]; });

// A function below makes its objects first, which begins the class above.
function Base(x) { this.x = x; }
Base.prototype.get = function () { return 1; };
function Below(x) { Base.call(this, x); }
Below.prototype = Object.create(Base.prototype);
show(function () { return ["below", sum(function (i) { return new Below(i); }, 200)]; });
var firstBase = Base.prototype;
Base.prototype = { get: function () { return 2; } };
show(function () { return ["base", sum(function (i) { return new Base(i); }, 200), sum(function (i) { return new Below(i); }, 200), new Below(1) instanceof Base, new Base(1) instanceof Base, firstBase.isPrototypeOf(new Below(1))]; });

// The store may not run.
function Perhaps(x) { this.x = x; }
Perhaps.prototype.get = function () { return 3; };
if (process.argv.length > 90) Perhaps.prototype = { get: function () { return 4; } };
show(function () { return ["perhaps", sum(function (i) { return new Perhaps(i); }, 200)]; });
function Surely(x) { this.x = x; }
Surely.prototype.get = function () { return 3; };
if (process.argv.length < 90) Surely.prototype = { get: function () { return 4; } };
show(function () { return ["surely", sum(function (i) { return new Surely(i); }, 200)]; });

// What is laid there runs code, or is no object.
var seen = [];
function Trapped(x) { this.x = x; }
Trapped.prototype = new Proxy({}, { get: function (t, k) { if (seen.length < 4) seen.push(String(k)); return k === "get" ? function () { return 7; } : undefined; }, set: function (t, k, v, r) { Object.defineProperty(r, k, { value: v + 1, writable: true, configurable: true, enumerable: true }); return true; } });
show(function () { return ["proxy", sum(function (i) { return new Trapped(i); }, 100), new Trapped(4).x, seen.join()]; });
function Accessed(x) { this.x = x; }
Accessed.prototype = { set x(v) { this.hidden = v * 2; }, get x() { return this.hidden + 1; }, get: function () { return this.x; } };
show(function () { return ["accessor", sum(function (i) { return new Accessed(i); }, 200), Object.keys(new Accessed(1)).join()]; });
function Five(x) { this.x = x; }
Five.prototype = 5;
show(function () { return ["number", sum(function (i) { return new Five(i); }, 100), Object.getPrototypeOf(new Five(1)) === Object.prototype, Five.prototype]; });
function Nothing(x) { this.x = x; }
Nothing.prototype = null;
show(function () { return ["null", sum(function (i) { return new Nothing(i); }, 100), Object.getPrototypeOf(new Nothing(1)) === Object.prototype]; });
function Defined(x) { this.x = x; }
Object.defineProperty(Defined, "prototype", { value: { get: function () { return this.x + 1; } } });
show(function () { return ["defined", sum(function (i) { return new Defined(i); }, 200)]; });
function Frozen(x) { this.x = x; }
Frozen.prototype = Object.freeze({ x: 9, get: function () { return this.x; } });
show(function () { return ["frozen", sum(function (i) { return new Frozen(i); }, 100), Object.keys(new Frozen(1)).length]; });

// What happens behind the first object.
function Changed(x) { this.x = x; }
Changed.prototype = { get: function () { return this.x; } };
show(function () { return ["changed", sum(function (i) { return new Changed(i); }, 200)]; });
Changed.prototype.get = function () { return this.x * 2; };
show(function () { return ["changed", sum(function (i) { return new Changed(i); }, 200)]; });
show(function () { return ["relinked", sum(function (i) { var o = new Changed(i); if (i & 1) Object.setPrototypeOf(o, { get: function () { return 10000; } }); return o; }, 100)]; });
delete Changed.prototype.get;
show(function () { return ["deleted", sum(function (i) { return new Changed(i); }, 50)]; });
function Twice(x) { this.x = x; }
Twice.prototype = { get: function () { return 1; } };
function makeTwice(n) { var t = 0; for (var i = 0; i < n; i++) { if (i === 60) Twice.prototype = { get: function () { return 100; } }; t += new Twice(i).get(); } return t; }
show(function () { return ["twice", makeTwice(120)]; });

// A throw half way, another new.target, a shared object.
function Throws(x) { this.x = x; if (x % 50 === 3) throw new Error("three " + x); this.y = 1; }
Throws.prototype = { get: function () { return this.x + this.y; } };
function makeThrows(n) { var t = 0, caught = 0; for (var i = 0; i < n; i++) { try { t += new Throws(i).get(); } catch (e) { caught += e.message.length; } } return t + ":" + caught; }
show(function () { return ["throws", makeThrows(200)]; });
function Other() {}
Other.prototype = { get: function () { return 42; } };
show(function () { return ["target", sum(function (i) { return Reflect.construct(Plain, [i], Other); }, 100), Reflect.construct(Plain, [1], Other) instanceof Plain, Reflect.construct(Plain, [1], Other) instanceof Other]; });
var shared = { get: function () { return this.x; } };
function One(x) { this.x = x; }
function Two(x) { this.x = x + 1; }
One.prototype = shared;
Two.prototype = shared;
show(function () { return ["shared", sum(function (i) { return i & 1 ? new One(i) : new Two(i); }, 200), new One(1) instanceof Two, new Two(1) instanceof One]; });

// What a transpiler of classes writes: a function links the prototype objects, the constructor below calls the one above by .call | .apply and goes on with what that answers, or with `this`.
var link = function (d, b) { Object.setPrototypeOf(d, b); function Between() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (Between.prototype = b.prototype, new Between()); };
var Above = (function () { function Above(name) { this.name = name; this.legs = 4; } Above.prototype.score = function () { return this.name.length + this.legs; }; return Above; }());
var Child = (function (parent) { link(Child, parent); function Child(name, age) { var self = parent.call(this, name) || this; self.age = age; return self; } Child.prototype.get = function () { return this.score() + this.age; }; return Child; }(Above));
var Bare = (function (parent) { link(Bare, parent); function Bare() { return parent !== null && parent.apply(this, arguments) || this; } Bare.prototype.get = function () { return this.score() * 2; }; return Bare; }(Child));
show(function () { return ["linked", sum(function (i) { return new Child("rex", i & 7); }, 300), sum(function (i) { return new Bare("bo", i & 3); }, 300), new Bare("a", 1) instanceof Above, new Bare("a", 1).constructor === Bare, Object.keys(new Bare("a", 1)).join()]; });
var Answers = (function () { function Answers(x) { if (x & 1) return { odd: true, x: x, get: function () { return -this.x; } }; this.x = x; } Answers.prototype.get = function () { return this.x; }; return Answers; }());
var Takes = (function (parent) { link(Takes, parent); function Takes(x, y) { var self = parent.call(this, x) || this; self.y = y; return self; } return Takes; }(Answers));
show(function () { return ["answers", sum(function (i) { return new Takes(i, 1); }, 300), new Takes(1, 2) instanceof Takes, new Takes(2, 2) instanceof Takes, JSON.stringify(new Takes(1, 2)), JSON.stringify(new Takes(2, 2))]; });
var Strict = (function (parent) { "use strict"; link(Strict, parent); function Strict(name) { var self = parent.call(this, name) || this; self.strict = this === self; return self; } Strict.prototype.get = function () { return this.strict ? this.score() : -1; }; return Strict; }(Above));
show(function () { return ["strict", sum(function (i) { return new Strict("abc"); }, 200)]; });
show(function () { Strict("no new"); return ["without new"]; });
var Primitive = (function () { function Primitive(x) { this.x = x; return x & 1 ? "text" : 0; } Primitive.prototype.get = function () { return this.x; }; return Primitive; }());
var OverPrimitive = (function (parent) { link(OverPrimitive, parent); function OverPrimitive(x) { var self = parent.call(this, x) || this; if (typeof self === "object") self.z = 1; return self; } return OverPrimitive; }(Primitive));
show(function () { return ["primitive", sum(function (i) { return new OverPrimitive(i); }, 200), typeof new OverPrimitive(1), JSON.stringify(new OverPrimitive(1)), JSON.stringify(new OverPrimitive(2))]; });
var replaced = Above.prototype.score;
Above.prototype.score = function () { return 1; };
show(function () { return ["replaced above", sum(function (i) { return new Child("rex", i & 7); }, 100), sum(function (i) { return new Bare("bo", 1); }, 100)]; });
Above.prototype.score = replaced;
show(function () { return ["after", sum(function (i) { return new Child("rex", i & 7); }, 100)]; });
