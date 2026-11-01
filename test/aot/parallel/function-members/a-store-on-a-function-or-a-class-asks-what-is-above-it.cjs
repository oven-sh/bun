// A store by name on a function or a class object: what it meets on the object itself and on every object above it.
const lines = [];
const say = (...words) => lines.push(words.map(word => (typeof word === "symbol" ? word.toString() : String(word))).join(" "));
const attempt = (label, run) => {
  try {
    say(label, run());
  } catch (error) {
    say(label, "threw", error.constructor.name);
  }
};
const describe = (object, key) => {
  const found = Object.getOwnPropertyDescriptor(object, key);
  if (!found) return "none";
  return "value" in found
    ? `value ${String(found.value)} ${found.writable} ${found.enumerable} ${found.configurable}`
    : `accessor ${typeof found.get} ${typeof found.set} ${found.enumerable} ${found.configurable}`;
};
const strictly = (object, key, value) => {
  "use strict";
  object[key] = value;
  return object[key];
};

function plain() {}
plain.extra = 1;
plain.extra = 2;
plain.more = "x";
say("plain", describe(plain, "extra"), describe(plain, "more"), Object.keys(plain).join());

class Base {
  static declared = 1;
  static method() {
    return "method";
  }
  static set guarded(value) {
    say("the setter of Base got", value, this === Base ? "Base" : this.name);
  }
  static get guarded() {
    return "from the getter";
  }
  static get onlyRead() {
    return "only read";
  }
}
class Below extends Base {}
class Lowest extends Below {}
Below.extra = 1;
Lowest.extra = 2;
say("classes", describe(Base, "extra"), describe(Below, "extra"), describe(Lowest, "extra"));
Below.guarded = 3;
Lowest.guarded = 4;
say("guarded", describe(Below, "guarded"), describe(Lowest, "guarded"), Lowest.guarded);
Below.declared = 5;
say("declared", Base.declared, describe(Below, "declared"), Lowest.declared);
Lowest.method = 6;
say("method", typeof Base.method, typeof Below.method, describe(Lowest, "method"));
Below.onlyRead = 7;
say("only read, sloppy", describe(Below, "onlyRead"), Below.onlyRead);
attempt("only read, strict", () => strictly(Lowest, "onlyRead", 8));

Object.defineProperty(Base, "fixed", { value: "fixed", writable: false, configurable: true });
Below.fixed = 9;
say("fixed, sloppy", describe(Below, "fixed"), Below.fixed);
attempt("fixed, strict", () => strictly(Below, "fixed", 10));
Object.defineProperty(Base, "fixed", { value: "loose", writable: true });
Below.fixed = 11;
say("fixed no more", describe(Below, "fixed"), Base.fixed);

class Untouched {
  static set late(value) {
    say("the setter of Untouched got", value);
  }
  static kept = "kept";
}
class BelowUntouched extends Untouched {}
BelowUntouched.late = 12;
BelowUntouched.kept = 13;
BelowUntouched.other = 14;
say("untouched", describe(BelowUntouched, "late"), describe(BelowUntouched, "kept"), describe(BelowUntouched, "other"), Untouched.kept);

function Parent() {}
function Child() {}
Object.setPrototypeOf(Child, Parent);
Child.extra = 1;
say("functions", describe(Parent, "extra"), describe(Child, "extra"));
Object.defineProperty(Parent, "watched", {
  set(value) {
    say("the setter of Parent got", value, this === Child);
  },
  configurable: true,
});
Child.watched = 2;
say("watched", describe(Child, "watched"));
delete Parent.watched;
Child.watched = 3;
say("watched no more", describe(Child, "watched"));

function special() {}
special.name = "renamed";
special.length = 7;
say("name and length, sloppy", special.name, special.length, describe(special, "name"));
attempt("name, strict", () => strictly(special, "name", "again"));
attempt("length, strict", () => strictly(special, "length", 9));
const replaced = { marker: true };
special.prototype = replaced;
say("prototype", special.prototype === replaced, describe(special, "prototype").replace(/value \S+ \S+/, "value"), new special().marker);
attempt("prototype of a class, strict", () => strictly(Below, "prototype", {}));
Below.prototype = {};
say("prototype of a class, sloppy", Below.prototype === Object.getPrototypeOf(new Below()));
attempt("caller", () => strictly(special, "caller", 1));
attempt("arguments", () => strictly(special, "arguments", 1));
special.displayName = "shown";
say("displayName", describe(special, "displayName"));

function numbered() {}
numbered[0] = "zero";
numbered["1"] = "one";
numbered[-1] = "minus";
numbered[4294967295] = "large";
say("indices", Object.keys(numbered).join(), numbered[0], numbered[1]);
const mark = Symbol("mark");
numbered[mark] = "symbol";
Lowest[mark] = "symbol";
say("symbols", describe(numbered, mark), describe(Lowest, mark), describe(Below, mark));
attempt("hasInstance, strict", () => strictly(numbered, Symbol.hasInstance, () => true));
numbered[Symbol.hasInstance] = () => true;
say("hasInstance, sloppy", describe(numbered, Symbol.hasInstance));

function relinked() {}
relinked.__proto__ = Parent;
say("__proto__", Object.getPrototypeOf(relinked) === Parent, describe(relinked, "__proto__"));
const bare = function () {};
Object.setPrototypeOf(bare, null);
bare.extra = 1;
bare.__proto__ = 2;
say("nothing above", describe(bare, "extra"), describe(bare, "__proto__"));

function closed() {}
closed.before = 1;
Object.preventExtensions(closed);
closed.before = 2;
closed.after = 3;
say("not extensible, sloppy", describe(closed, "before"), describe(closed, "after"));
attempt("not extensible, strict", () => strictly(closed, "after", 4));
class Frozen extends Base {}
Frozen.own = 1;
Object.freeze(Frozen);
Frozen.own = 2;
Frozen.extra = 3;
say("frozen, sloppy", describe(Frozen, "own"), describe(Frozen, "extra"));
attempt("frozen, strict", () => strictly(Frozen, "own", 4));

const seen = [];
function behindProxy() {}
Object.setPrototypeOf(
  behindProxy,
  new Proxy(function () {}, {
    set(target, key, value, receiver) {
      seen.push(`${String(key)} ${value} ${receiver === behindProxy}`);
      return Reflect.defineProperty(receiver, key, { value: value * 2, writable: true, enumerable: true, configurable: true });
    },
  }),
);
behindProxy.extra = 21;
behindProxy.extra = 4;
say("a proxy above", seen.join(), describe(behindProxy, "extra"));

function lent() {}
const receiver = {};
say("another receiver", Reflect.set(lent, "extra", 1, receiver), describe(lent, "extra"), describe(receiver, "extra"));
say("another receiver, a class", Reflect.set(Lowest, "guarded", 2, receiver), describe(receiver, "guarded"));
say("another receiver, a function", Reflect.set(Below, "fresh", 3, plain), describe(Below, "fresh"), describe(plain, "fresh"));
say("a primitive receiver", Reflect.set(lent, "extra", 1, 5), describe(lent, "extra"));

const bound = plain.bind(null);
bound.extra = 1;
const arrow = () => {};
arrow.extra = 2;
async function waits() {}
waits.extra = 3;
function* yields() {}
yields.extra = 4;
yields.prototype = 5;
say("other kinds", describe(bound, "extra"), describe(arrow, "extra"), describe(waits, "extra"), describe(yields, "extra"), yields.prototype);

function tagged(fn, value) {
  fn.tag = value;
  return fn;
}
const all = [];
for (let index = 0; index < 40; index++) all.push(tagged(index % 3 ? function () {} : class extends Base {}, index));
say("many", all.map(fn => fn.tag).join());
function filled() {}
for (let index = 0; index < 80; index++) filled["n" + index] = index;
filled.n3 = "again";
say("filled", Object.keys(filled).length, filled.n3, filled.n79);

console.log(lines.join("\n"));
