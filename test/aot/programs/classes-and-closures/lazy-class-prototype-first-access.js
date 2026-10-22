// A class prototype creates its members at first use. Each class here has its prototype touched first in a different way through an untyped alias, and afterwards the prototype must look like any other.
function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.name;
  }
}

function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      const kind = "value" in descriptor ? typeof descriptor.value : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
      const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
      return String(key) + ":" + kind + ":" + flags;
    })
    .join(" ");
}

function check(name, K, S, touch) {
  const early = new K();
  const p = K.prototype;
  console.log(name + ": " + attempt(() => touch(p)));
  const k = new K();
  const sub = new S();
  console.log("  " + describe(p));
  console.log("  extensible " + Object.isExtensible(p) + ", early.m() " + attempt(() => early.m()) + ", k.m() " + attempt(() => k.m()) + ", k.g " + attempt(() => k.g) + ", sub.m() " + attempt(() => sub.m()) + ", sub.g " + attempt(() => sub.g));
  console.log("  sub.x " + sub.x + ", sub[0] " + sub[0] + ", sub.inherited " + typeof sub.inherited + ", chain " + (Object.getPrototypeOf(S.prototype) === p) + ", " + describe(S.prototype));
}

class K1 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S1 extends K1 {}
class K2 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S2 extends K2 {}
class K3 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S3 extends K3 {}
class K4 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S4 extends K4 {}
class K5 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S5 extends K5 {}
class K6 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S6 extends K6 {}
class K7 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S7 extends K7 {}
class K8 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S8 extends K8 {}
class K9 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S9 extends K9 {}
class K10 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S10 extends K10 {}
class K11 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S11 extends K11 {}
class K12 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S12 extends K12 {}
class K13 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S13 extends K13 {}
class K14 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S14 extends K14 {}
class K15 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S15 extends K15 {}
class K16 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S16 extends K16 {}
class K17 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S17 extends K17 {}
class K18 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S18 extends K18 {}
class K19 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S19 extends K19 {}
class K20 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S20 extends K20 {}
class K21 { m() { return 1; } get g() { return 2; } set g(v) {} }
class S21 extends K21 {}
class Thenable { then(resolve) { resolve("declared then"); } }
class SubThenable extends Thenable {}

const q = { inherited() {} };

check("p.m", K1, S1, p => typeof p.m);
check('"m" in p', K2, S2, p => "m" in p);
check("p.missing", K3, S3, p => p.missing);
check("p[Symbol.iterator]", K4, S4, p => p[Symbol.iterator]);
check("p.constructor", K5, S5, p => p.constructor === K5);
check("Object.keys(p)", K6, S6, p => Object.keys(p).length);
check("Reflect.ownKeys(p)", K7, S7, p => Reflect.ownKeys(p).join());
check('Object.getOwnPropertyDescriptor(p, "g")', K8, S8, p => typeof Object.getOwnPropertyDescriptor(p, "g").get);
check("p.x = 1", K9, S9, p => (p.x = 1));
check("p[0] = 1", K10, S10, p => (p[0] = 1));
check("delete p.m", K11, S11, p => delete p.m);
check('Object.defineProperty(p, "m", ..)', K12, S12, p => Object.defineProperty(p, "m", { value() { return 12; }, enumerable: true }) === p);
check("Object.freeze(p)", K13, S13, p => Object.freeze(p) === p);
check("Object.setPrototypeOf(p, q)", K14, S14, p => Object.setPrototypeOf(p, q) === p);
console.log("distinct methods: " + new Set([K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K13, K14].map(K => K.prototype.m)).size);

check("Object.isExtensible(p), then p.x = 1", K15, S15, p => [Object.isExtensible(p), (p.x = 1), p.x].join());
check("ten missing names", K16, S16, p => [["a", "b", "c", "d", "e", "f", "h", "i", "j", "n"].every(name => p[name] === undefined), p.m === p.m, p.m === new K16().m].join());
check("one name three times", K17, S17, p => {
  const first = Reflect.get(p, "m");
  const second = Reflect.get(p, "m");
  const third = Reflect.get(p, "m");
  return [first === second, second === third, third === Object.getOwnPropertyDescriptor(p, "m").value, first.call(p)].join();
});
check("p.g", K18, S18, p => [Reflect.get(p, "g"), Reflect.has(p, "g"), p.g, Reflect.set(p, "g", 3), p.g].join());
check("Error.captureStackTrace(p)", K20, S20, p => [Error.captureStackTrace(p), typeof p.stack, typeof new S20().stack].join());
check("map defines p[0]", K21, S21, p => {
  const source = [7];
  source.constructor = { [Symbol.species]: function () { return p; } };
  return source.map(value => value) === p;
});

class StackBase { get stack() { return "declared"; } }
class StackSub extends StackBase {}
const stackSub = new StackSub();
function readStack(object) {
  return object.stack;
}
let declaredReads = 0;
for (let i = 0; i < 10000; i++) {
  if (readStack(stackSub) === "declared") declaredReads++;
}
Error.captureStackTrace([StackSub.prototype][0]);
console.log("a getter hidden by a native store: " + [declaredReads, readStack(stackSub) === "declared", typeof readStack(stackSub), readStack(new StackBase()), Object.getOwnPropertyNames(StackSub.prototype).join()].join());

const k = new K19();
const sub = new S19();
console.log("await without then: " + [(await k) === k, (await k) === k, (await sub) === sub].join());
K19.prototype.then = function (resolve) {
  resolve("then of " + this.constructor.name);
};
console.log("await with then: " + [await k, await sub, await new K19()].join());
console.log("await with a declared then: " + [await new Thenable(), await new Thenable(), await new SubThenable()].join());
