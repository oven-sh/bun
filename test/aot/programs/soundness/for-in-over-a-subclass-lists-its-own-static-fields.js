// for-in over a class object lists its own static fields first, then those of the classes it extends.
function keysOf(object) {
  const found = [];
  for (const key in object) found.push(key);
  return found.join();
}

class Base {
  static a = 1;
  static b = 2;
  static hidden() {}
}
class Heir extends Base {
  static z = 3;
  static y = 4;
}
console.log(keysOf(Heir));
console.log(keysOf(Base));

class Lowest extends Heir {
  static a = "shadows";
  static last = 5;
}
for (const key in Lowest) console.log(key, Lowest[key]);

function make(tag) {
  return class extends Base {
    static tag = tag;
  };
}
console.log(keysOf(make("one")), keysOf(make("two")));

class Alone {
  static only = 1;
}
console.log(keysOf(Alone));

// What TypeScript's __extends does for a target without Object.setPrototypeOf.
function copyStatics(to, from) {
  for (const key in from) if (Object.prototype.hasOwnProperty.call(from, key)) to[key] = from[key];
  return to;
}
console.log(JSON.stringify(copyStatics({}, Heir)));
