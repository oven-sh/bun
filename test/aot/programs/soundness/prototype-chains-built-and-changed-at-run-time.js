// Ordinary npm-style code: mixins, prototype chains changed late, inheritance by util.inherits, monkey patches on own classes, duck typing.
const util = require("node:util"); const { EventEmitter } = require("node:events");
function Stream(name) { EventEmitter.call(this); this.name = name; this.count = 0; }
util.inherits(Stream, EventEmitter);
Stream.prototype.write = function (x) { this.count += x.length; this.emit("data", x); return this; };
const s = new Stream("s"); let got = ""; s.on("data", d => { got += d; }); s.write("ab").write("c"); console.log(s.count, got, s instanceof EventEmitter, Object.keys(s).sort().join());
const Serializable = Base => class extends Base { serialize() { return JSON.stringify(this); } };
const Named = Base => class extends Base { constructor(...a) { super(...a); this.tag = "n"; } hello() { return "hi " + this.tag + this.x; } };
class Point { constructor(x) { this.x = x; } }
const P2 = Named(Serializable(Point)); const p = new P2(4); console.log(p.serialize(), p.hello(), p instanceof Point);
const P3 = Named(Serializable(Object)); console.log(new P3().hello());
function extend(target) { for (let i = 1; i < arguments.length; i++) for (const k in arguments[i]) target[k] = arguments[i][k]; return target; }
function Model(attrs) { this.attrs = extend({}, this.defaults, attrs); }
extend(Model.prototype, { defaults: { a: 1, b: "two" }, get(k) { return this.attrs[k]; }, set(k, v) { this.attrs[k] = v; return this; } });
const m = new Model({ b: 2 }); console.log(m.get("a") + m.get("b"), m.set("a", "x").get("a") + 1);
const orig = Model.prototype.get; Model.prototype.get = function (k) { return "[" + orig.call(this, k) + "]"; }; console.log(m.get("a"));
class A { who() { return "A"; } call() { return this.who(); } } class B extends A { who() { return "B"; } }
const objs = [new A(), new B()]; console.log(objs.map(o => o.call()).join()); B.prototype.who = () => "B2"; console.log(objs.map(o => o.call()).join());
Object.setPrototypeOf(B.prototype, { who() { return "X"; }, call() { return "other " + this.who(); } }); delete B.prototype.who; console.log(objs.map(o => o.call()).join(), objs[1] instanceof A);
const own = new A(); own.who = function () { return "own"; }; console.log(own.call(), new A().call());
function duck(o) { return o.quack(); } console.log(duck({ quack() { return 1; } }), duck({ quack: () => "two" }), duck(new (class { quack() { return 3n; } })()), duck(Object.create({ quack() { return null; } })));
const cache = Object.create(null); function memo(k, f) { return k in cache ? cache[k] : (cache[k] = f()); } console.log(memo("a", () => 1), memo("a", () => 2), memo("__proto__", () => 3), memo("__proto__", () => 4), memo("constructor", () => 5), Object.keys(cache).join());
const dict = {}; for (const w of ["a", "constructor", "a", "toString", "__proto__", "hasOwnProperty"]) dict[w] = (dict[w] || 0) + 1; console.log(JSON.stringify(dict), typeof dict.constructor, Object.keys(dict).length);
function Legacy() { if (!(this instanceof Legacy)) return new Legacy(); this.ok = true; } console.log(Legacy().ok, new Legacy().ok, Legacy.call({}).ok);
const opts = Object.assign({ retries: 3, name: "d" }, JSON.parse('{"retries":"5"}'), null, undefined, "xy"); console.log(opts.retries * 2, opts[0], opts.name.length);
class Temp { static #count = 0; static create() { Temp.#count++; return new Temp(); } static get count() { return Temp.#count; } } Temp.create(); Temp.create(); console.log(Temp.count);
const sym = Symbol("s"); class WithSym { [sym] = 1; [Symbol.toPrimitive](h) { return h === "number" ? 42 : "str"; } } const ws = new WithSym(); console.log(+ws, `${ws}`, ws + "", ws[sym]);
const arrLike = { length: 2, 0: "a", 1: "b" }; console.log(Array.prototype.map.call(arrLike, x => x + x).join(), Array.from(arrLike).length, Array.prototype.slice.call("xyz", 1).join());
