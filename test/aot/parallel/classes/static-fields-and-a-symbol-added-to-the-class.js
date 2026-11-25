// A property under a symbol that a class gets later leaves its static fields where they are; the order of its keys and what is asked of them stay the same.
const of = Symbol("of");
const at = Symbol("at");
class Counter {
  static total = 0;
  static name2 = "n";
  static add(by) {
    Counter.total = (Counter.total + by) | 0;
    return Counter.total;
  }
}
Counter[of] = "x";
let last = 0;
for (let i = 0; i < 1000; i++) last = Counter.add(i);
console.log(last, Counter[of], Counter.total);
Object.defineProperty(Counter, at, { value: 2, enumerable: false });
console.log(Counter.add(1), Counter[at], Object.keys(Counter).join());
Counter.later = 3;
console.log(Reflect.ownKeys(Counter).map(String).join());
console.log(Counter.add(1), JSON.stringify(Object.getOwnPropertyDescriptor(Counter, "total")));
class Frozen {
  static a = 1;
}
Frozen[of] = 1;
Object.freeze(Frozen);
try {
  Frozen.a = 2;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log(Frozen.a, Object.isFrozen(Frozen), delete Counter[of], Reflect.ownKeys(Counter).length);
class Below extends Counter {
  static own = 5;
}
Below[of] = 7;
Below.total = 9;
console.log(Below.own, Below.total, Counter.total, Reflect.ownKeys(Below).map(String).join());
class Accessor {
  static v = 1;
  static set [of](value) {
    Accessor.v = value;
  }
}
Accessor[of] = 4;
console.log(Accessor.v, Object.keys(Accessor).join());
