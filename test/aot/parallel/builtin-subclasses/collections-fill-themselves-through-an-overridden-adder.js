const seen = [];
class Doubling extends Set {
  add(value) {
    seen.push(value);
    return super.add(value * 2);
  }
}
const doubled = new Doubling([1, 2, 3]);
console.log(seen.join(), [...doubled].join(), doubled.size);

class Upper extends Map {
  set(key, value) {
    return super.set(key.toUpperCase(), { boxed: value });
  }
}
const upper = new Upper([["a", { deep: 1 }]]);
console.log(upper.get("A").boxed.deep, upper.has("a"));

class Plain extends Set {
  constructor(values) {
    super(values);
  }
}
console.log(new Plain("abca").size, new Plain().size, new Plain([{}]).has(1));

const kept = [];
class Remembering extends WeakSet {
  add(value) {
    kept.push(value);
    return super.add(value);
  }
}
const member = { name: "member", greet: () => "hello" };
const remembering = new Remembering([member]);
console.log(kept[0] === member, kept[0].greet(), remembering.has(member));

const order = [];
class Late extends WeakMap {}
for (const name of ["set"])
  Late.prototype[name] = function (key, value) {
    order.push(value.label);
    return WeakMap.prototype.set.call(this, key, value);
  };
console.log(new Late([[member, { label: "first" }]]).get(member).label, order.join());

class Broken extends Set {}
Broken.prototype.add = 5;
try {
  new Broken([1]);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(new Broken().size);

class Throwing extends Map {
  set() {
    throw new RangeError("full");
  }
}
try {
  new Throwing([[1, 2]]);
} catch (error) {
  console.log(error.message, error instanceof RangeError);
}
