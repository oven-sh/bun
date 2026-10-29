// A constructor function keeps state in `this` under symbols that a table of symbols holds. Only code out of run-time text constructs with it, so no build sees where its objects are made.
const symbols = { kState: Symbol("state"), kCount: Symbol("count"), kLate: Symbol("late"), kNever: Symbol("never") };
const { kState, kCount, kLate, kNever } = symbols;
const nothing = String(Date.now()).slice(99);
const lines = [];
const say = (...parts) => lines.push(parts.map(part => (typeof part === "symbol" ? part.toString() : typeof part === "object" && part ? JSON.stringify(part) : String(part))).join(" "));

function Holder(name, skip) {
  this.name = name;
  if (!skip) this[kState] = "new";
  this[kCount] = 0;
}
Holder.prototype.step = function () {
  this[kCount]++;
  return this;
};
Holder.prototype.describe = function () {
  return `${this.name}:${String(this[kState])}:${this[kCount]}:${String(this[kLate])}:${String(this[kNever])}`;
};
Holder.prototype.finish = function (value) {
  this[kLate] = value;
  return this;
};

function makeBelow(Above) {
  const extras = Above.extras ? Above.extras.slice() : [];
  function Below(name, skip) {
    this.name = name;
    if (!skip) this[kState] = "below";
    this[kCount] = 10;
    for (let i = 0; i < extras.length; i++) this[extras[i].key] = extras[i].value;
  }
  Object.setPrototypeOf(Below.prototype, Above.prototype);
  Object.setPrototypeOf(Below, Above);
  Below.extras = extras;
  return Below;
}
Holder.extras = [{ key: "user" + nothing, value: undefined }, { key: kLate, value: "decorated" }];

const construct = new Function("C", "a", "b", "return new C(a, b)" + nothing);
const reflect = new Function("C", "T", "a", "return Reflect.construct(C, [a], T)" + nothing);
const Below = makeBelow(Holder);
const Lower = makeBelow(Below);

for (const C of [Holder, Below, Lower]) {
  const whole = construct(C, "whole", false);
  say(whole.describe(), Object.getOwnPropertySymbols(whole).map(String).join(), Object.keys(whole).join());
  say(whole.step().step().finish(7).describe(), Object.getOwnPropertySymbols(whole).map(String).join());
  const partial = construct(C, "partial", true);
  say(partial.describe(), kState in partial, Object.hasOwn(partial, kState), Object.getOwnPropertySymbols(partial).length);
}

// What lies above the objects answers for a slot that is empty, and takes a store where it is a setter.
const partial = construct(Below, "inherits", true);
Holder.prototype[kState] = "from Holder.prototype";
say(partial.describe(), construct(Below, "own", false).describe());
Below.prototype[kState] = "from Below.prototype";
say(partial.describe(), construct(Lower, "lower", true).describe());
delete Below.prototype[kState];
delete Holder.prototype[kState];
say(partial.describe());

let stored = [];
Object.defineProperty(Holder.prototype, kCount, {
  configurable: true,
  get() {
    return "getter";
  },
  set(value) {
    stored.push(`${this.name}=${value}`);
  },
});
const behindSetter = construct(Below, "behind-setter", false);
say(behindSetter.describe(), Object.hasOwn(behindSetter, kCount), stored.join());
behindSetter.step();
say(behindSetter.describe(), stored.join());
delete Holder.prototype[kCount];
say(behindSetter.describe(), construct(Below, "after", false).step().describe());

// The function is called on an object of another kind, and with another new.target.
const plain = { name: "plain" };
Holder.call(plain, "called", false);
say(Holder.prototype.describe.call(plain), Object.getOwnPropertySymbols(plain).length);
class Other {
  describe() {
    return "other:" + String(this[kState]) + ":" + this[kCount];
  }
}
const other = reflect(Below, Other, "reflected");
say(other.describe(), other instanceof Other, other instanceof Below, Object.getOwnPropertySymbols(other).map(String).join());

// Fields leave, come back in another order, and are redefined.
const changed = construct(Lower, "changed", false);
delete changed[kState];
say(changed.describe(), Object.getOwnPropertySymbols(changed).map(String).join());
changed[kState] = "again";
say(changed.describe(), Object.getOwnPropertySymbols(changed).map(String).join());
Object.defineProperty(changed, kCount, { get: () => "own getter", configurable: true });
const attempt = action => {
  try {
    return action().describe();
  } catch (error) {
    return error.constructor.name;
  }
};
say(changed.describe(), attempt(() => changed.step()));
Object.freeze(changed);
say(attempt(() => ((changed[kState] = "frozen"), changed)), attempt(() => changed.finish(1)), changed.describe());

// Every object of a long run answers alike.
let sum = 0;
for (let i = 0; i < 20000; i++) {
  const object = construct(i & 1 ? Below : Lower, "n" + (i & 3), (i & 7) === 7);
  object.step();
  if ((i & 15) === 3) object.finish(i);
  sum = (sum + object.describe().length + object[kCount]) | 0;
}
say(sum);
console.log(lines.join("\n"));
