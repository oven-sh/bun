// A class in JavaScript with private fields, private methods, public fields and arrow-function fields: what `new` gives each object, in which order, and what happens when a member cannot be added.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const thrownBy = f => { try { f(); return "nothing"; } catch (error) { return error.constructor.name; } };

class Context {
  #raw;
  #request;
  env = {};
  #variables;
  finalized = false;
  error;
  #status = 200;
  #headers;
  #path;
  constructor(raw, options) {
    this.#raw = raw;
    if (options) {
      this.env = options.env;
      this.#path = options.path;
    }
  }
  #respond(body, type) { return this.#status + " " + type + " " + body + " " + this.#path + " " + this.#raw; }
  get #kind() { return this.#headers ? "with headers" : "bare"; }
  set #kind(value) { this.#headers = value; }
  text = body => this.#respond(body, "text");
  json = body => this.#respond(JSON.stringify(body), "json");
  status = status => { this.#status = status; return this; };
  header = value => { this.#kind = value; return this.#kind; };
  kind = () => this.#kind;
  static has(object) { return [#raw in object, #respond in object, #kind in object, #path in object].join(); }
  static assignToMethod(object) { object.#respond = 1; }
}
const describe = c => Object.keys(c).join() + " | " + JSON.stringify(c) + " | " + c.text("a") + " | " + c.status(201).json({ b: 1 }) + " | " + c.kind() + " " + c.header(1) + " | " + Context.has(c);
const env = { name: "env" };
const make = i => new Context("raw" + (i & 1), i & 2 ? { env, path: "/p" } : undefined);
const seen = new Set();
const asksBefore = count("operationAOTTryPutProperties");
for (let i = 0; i < 60; i++) seen.add(describe(make(i)));
const asks = count("operationAOTTryPutProperties") - asksBefore;
for (let i = 0; i < 340; i++) seen.add(describe(make(i)));
const names = ["operationAOTPrivateMethodsAdd", "operationAOTPrivateFieldAdd", "operationAOTTryPutProperties"];
const before = names.map(name => count(name));
for (let i = 0; i < 1000; i++) seen.add(describe(make(i)));
const calls = names.map((name, i) => count(name) - before[i]).reduce((a, b) => a + b);
console.log([...seen].sort().join("\n"));
console.log(asks <= 10 ? "the members were learnt as one step in at most 10 calls" : "the run time was asked " + asks + " times to add the members in one step");
console.log(calls < 100 ? "1,000 objects were made with under 100 calls of the run time" : "1,000 objects were made with " + calls + " calls of the run time");
collect();
console.log(describe(make(3)));
console.log(JSON.stringify(Object.getOwnPropertyDescriptors(make(0)), (key, value) => typeof value === "function" ? "function " + value.name : value));
console.log(Reflect.ownKeys(make(0)).length, make(0).text !== make(0).text, thrownBy(() => Context.assignToMethod(make(0))), thrownBy(() => Context.assignToMethod({})), Context.has({}));

// The object comes from somewhere else: a base class that returns what it is handed.
class Returns { constructor(object) { return object; } }
class Stamp extends Returns {
  #first = "first";
  visible = "visible";
  #second = "second";
  #method() { return "method"; }
  static read(object) { return attempt(() => object.#first + " " + object.#second + " " + object.#method()); }
  static has(object) { return [#first in object, #second in object, #method in object].join(); }
}
for (let round = 0; round < 3; round++) {
  const plain = { own: 1 };
  console.log(Stamp.read(new Stamp(plain)), Object.keys(plain).join(), attempt(() => new Stamp(plain)), Stamp.has(plain));
  const frozen = Object.freeze({ own: 1 });
  console.log(attempt(() => new Stamp(frozen)), Stamp.has(frozen), Object.keys(frozen).join());
  const sealed = Object.preventExtensions({ visible: "there" });
  console.log(attempt(() => Stamp.read(new Stamp(sealed))), Stamp.has(sealed), sealed.visible);
  const log = [];
  const proxy = new Proxy({}, { defineProperty(target, key, descriptor) { log.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor); }, has(target, key) { log.push("has " + String(key)); return key in target; } });
  console.log(Stamp.read(new Stamp(proxy)), Stamp.has(proxy), log.join());
  const array = [1, 2];
  console.log(Stamp.read(new Stamp(array)), JSON.stringify(array), array.visible);
  const func = function () {};
  console.log(Stamp.read(new Stamp(func)), func.visible, Stamp.has(func));
  const inherits = Object.create({ set visible(value) { log.push("setter"); }, get visible() { return "inherited"; } });
  console.log(Stamp.read(new Stamp(inherits)), inherits.visible, Object.keys(inherits).join(), log.includes("setter"));
  const readOnly = Object.create(Object.freeze({ visible: "frozen above" }));
  console.log(Stamp.read(new Stamp(readOnly)), readOnly.visible);
  const dictionary = {};
  for (let i = 0; i < 200; i++) dictionary["k" + i] = i;
  for (let i = 0; i < 190; i++) delete dictionary["k" + i];
  console.log(Stamp.read(new Stamp(dictionary)), Object.keys(dictionary).length);
  const half = new Returns({});
  class First extends Returns { #first = 1; static has(object) { return #first in object; } }
  console.log(First.has(new First(half)), Stamp.has(half), Stamp.read(new Stamp(half)));
}

// An initializer that looks at the object sees what has been added so far, and nothing more.
class Watched {
  #a = 1;
  b = Object.keys(this).join() + (#a in this) + (#c in this) + this.#m();
  #c = 3;
  d = Object.keys(this).join() + (#c in this) + (#e in this);
  #e = (() => { if (Watched.fails) throw new Error("the initializer of #e fails"); return 5; })();
  f = () => this.#a + this.#c + this.#e;
  #m() { return "m"; }
  static fails = false;
  static state(object) { return [#a in object, #c in object, #e in object, #m in object].join() + " " + Object.keys(object).join(); }
}
console.log(new Watched().b, new Watched().d, new Watched().f());
class WatchedOn extends Returns {
  #a = 1;
  b = 2;
  #c = (() => { if (WatchedOn.fails) throw new Error("the initializer of #c fails"); return 3; })();
  d = 4;
  static fails = false;
  static state(object) { return [#a in object, #c in object].join() + " " + Object.keys(object).join(); }
}
for (let i = 0; i < 20; i++) new WatchedOn({});
WatchedOn.fails = true;
const partly = {};
console.log(attempt(() => new WatchedOn(partly)), WatchedOn.state(partly));
WatchedOn.fails = false;
console.log(attempt(() => new WatchedOn(partly)), WatchedOn.state(partly));

// A class that is evaluated more than once has names of its own each time.
const classes = [];
for (let i = 0; i < 3; i++) {
  classes.push(class {
    #x = i;
    #y = i * 2;
    z = i * 3;
    #sum() { return this.#x + this.#y + this.z; }
    sum = () => this.#sum();
    static has(object) { return #x in object && #sum in object; }
  });
}
console.log(classes.map(C => classes.map(D => C.has(new D())).join()).join(" "), classes.map(C => new C().sum()).join());

// Subclasses, each with members of its own, and several classes through one base constructor.
class Base { #base = "base"; shared = "shared"; #get() { return this.#base; } base = () => this.#get(); }
class Left extends Base { #left = "left"; l = 1; left = () => this.#left + this.base(); }
class Right extends Base { r = 2; #right = "right"; right = () => this.#right + this.base(); }
class Bare extends Base {}
const made = new Set();
for (let i = 0; i < 300; i++) {
  const object = i % 3 === 0 ? new Left() : i % 3 === 1 ? new Right() : new Bare();
  made.add(object.constructor.name + " " + Object.keys(object).join() + " " + (object.left ?? object.right ?? object.base)());
}
console.log([...made].sort().join(" | "));
console.log(Reflect.construct(Base, [], Left) instanceof Left, Object.keys(Reflect.construct(Base, [], Left)).join(), Object.keys(Reflect.construct(Left, [], Object)).join());

// More private methods than fit beside each other in a small object.
class Many {
  #a() { return 1; } #b() { return 2; } #c() { return 3; } #d() { return 4; } #e() { return 5; } #f() { return 6; } #g() { return 7; } #h() { return 8; } #i() { return 9; }
  #field = 10;
  sum() { return this.#a() + this.#b() + this.#c() + this.#d() + this.#e() + this.#f() + this.#g() + this.#h() + this.#i() + this.#field; }
}
let total = 0;
for (let i = 0; i < 200; i++) total += new Many().sum();
console.log(total);

// The prototype changes under a class whose objects have been made many times.
Object.defineProperty(Context.prototype, "finalized", { set(value) { throw new Error("a definition calls no setter"); }, configurable: true });
console.log(describe(make(3)));
Object.setPrototypeOf(Context.prototype, { get error() { return "inherited"; } });
console.log(describe(make(2)), make(2).error);
collect();
console.log(describe(make(1)));
