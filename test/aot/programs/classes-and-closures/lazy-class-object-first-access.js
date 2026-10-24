// A class object creates its own properties at first use. Each class here has no parent and has its class object touched first in a different way through an untyped alias, and afterwards the class object must look like any other.
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

function look(K) {
  console.log("  " + describe(K));
  console.log("  extensible " + Object.isExtensible(K) + ", s() " + attempt(() => K.s()) + ", g " + attempt(() => K.g) + ", new K().m() " + attempt(() => new K().m()) + ", constructor " + attempt(() => K.prototype.constructor === K) + ", parent " + (Object.getPrototypeOf(K) === Function.prototype));
}

// K has a subclass, L has none.
function check(name, K, S, L, touch) {
  console.log(name + ": " + attempt(() => touch(K)) + ", " + attempt(() => touch(L)));
  look(K);
  console.log("  S.s() " + attempt(() => S.s()) + ", S.g " + attempt(() => S.g) + ", S.x " + attempt(() => S.x) + ", S[0] " + attempt(() => S[0]) + ", S.inherited " + typeof S.inherited + ", chain " + (Object.getPrototypeOf(S) === K) + ", new S().m() " + attempt(() => new S().m()) + ", " + describe(S));
  look(L);
}

class K1 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S1 extends K1 {}
class L1 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K2 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S2 extends K2 {}
class L2 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K3 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S3 extends K3 {}
class L3 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K4 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S4 extends K4 {}
class L4 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K5 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S5 extends K5 {}
class L5 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K6 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S6 extends K6 {}
class L6 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K7 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S7 extends K7 {}
class L7 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K8 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S8 extends K8 {}
class L8 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K9 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S9 extends K9 {}
class L9 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K10 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S10 extends K10 {}
class L10 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K11 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S11 extends K11 {}
class L11 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K12 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S12 extends K12 {}
class L12 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K13 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S13 extends K13 {}
class L13 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K14 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S14 extends K14 {}
class L14 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K15 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S15 extends K15 {}
class L15 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K16 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S16 extends K16 {}
class L16 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K17 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S17 extends K17 {}
class L17 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K18 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S18 extends K18 {}
class L18 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K19 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S19 extends K19 {}
class L19 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K20 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S20 extends K20 {}
class L20 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K21 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S21 extends K21 {}
class L21 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K22 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S22 extends K22 {}
class L22 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K23 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S23 extends K23 {}
class L23 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K24 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S24 extends K24 {}
class L24 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K25 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S25 extends K25 {}
class L25 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K26 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S26 extends K26 {}
class L26 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K27 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S27 extends K27 {}
class L27 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K28 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S28 extends K28 {}
class L28 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K29 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S29 extends K29 {}
class L29 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K30 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S30 extends K30 {}
class L30 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K31 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S31 extends K31 {}
class L31 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K32 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S32 extends K32 {}
class L32 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K33 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S33 extends K33 {}
class L33 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K34 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S34 extends K34 {}
class L34 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K35 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S35 extends K35 {}
class L35 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K36 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S36 extends K36 {}
class L36 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K37 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S37 extends K37 {}
class L37 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K38 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S38 extends K38 {}
class L38 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K39 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S39 extends K39 {}
class L39 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K40 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S40 extends K40 {}
class L40 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K41 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S41 extends K41 {}
class L41 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K42 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S42 extends K42 {}
class L42 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K43 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S43 extends K43 {}
class L43 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K44 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S44 extends K44 {}
class L44 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K45 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S45 extends K45 {}
class L45 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K46 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S46 extends K46 {}
class L46 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K47 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S47 extends K47 {}
class L47 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K48 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S48 extends K48 {}
class L48 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K49 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S49 extends K49 {}
class L49 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K50 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S50 extends K50 {}
class L50 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K51 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S51 extends K51 {}
class L51 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K52 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S52 extends K52 {}
class L52 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K53 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S53 extends K53 {}
class L53 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K54 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S54 extends K54 {}
class L54 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K55 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S55 extends K55 {}
class L55 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K56 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S56 extends K56 {}
class L56 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K57 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S57 extends K57 {}
class L57 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K58 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S58 extends K58 {}
class L58 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K59 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S59 extends K59 {}
class L59 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K60 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S60 extends K60 {}
class L60 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class K61 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }
class S61 extends K61 {}
class L61 { static s() { return 1; } static get g() { return 2; } static set g(v) {} m() { return 3; } }

const q = { inherited() {} };

check("c.s()", K1, S1, L1, c => c.s());
check("typeof c.s", K2, S2, L2, c => typeof c.s);
check('"s" in c', K3, S3, L3, c => "s" in c);
check('Object.hasOwn(c, "s")', K4, S4, L4, c => Object.hasOwn(c, "s"));
check("c.g", K5, S5, L5, c => c.g);
check("c.g = 5", K6, S6, L6, c => (c.g = 5));
check("c.missing", K7, S7, L7, c => c.missing);
check("c[Symbol.iterator]", K8, S8, L8, c => c[Symbol.iterator]);
check("c.prototype", K9, S9, L9, c => typeof c.prototype);
check("c.name", K10, S10, L10, c => c.name);
check("c.length", K11, S11, L11, c => c.length);
check("Object.keys(c)", K12, S12, L12, c => Object.keys(c).length);
check("Reflect.ownKeys(c)", K13, S13, L13, c => Reflect.ownKeys(c).join());
check("Object.getOwnPropertyNames(c)", K14, S14, L14, c => Object.getOwnPropertyNames(c).join());
check("Object.getOwnPropertySymbols(c)", K15, S15, L15, c => Object.getOwnPropertySymbols(c).length);
check('Object.getOwnPropertyDescriptor(c, "prototype")', K16, S16, L16, c => Object.keys(Object.getOwnPropertyDescriptor(c, "prototype")).join());
check('Object.getOwnPropertyDescriptor(c, "g")', K17, S17, L17, c => typeof Object.getOwnPropertyDescriptor(c, "g").get);
check('Object.getOwnPropertyDescriptor(c, "missing")', K18, S18, L18, c => Object.getOwnPropertyDescriptor(c, "missing"));
check("c.x = 1", K19, S19, L19, c => (c.x = 1));
check("c[0] = 1", K20, S20, L20, c => (c[0] = 1));
check("delete c.s", K21, S21, L21, c => delete c.s);
check("delete c.prototype", K22, S22, L22, c => delete c.prototype);
check("delete c.missing", K23, S23, L23, c => delete c.missing);
check('Object.defineProperty(c, "s", ..)', K24, S24, L24, c => Object.defineProperty(c, "s", { value() { return 20; }, enumerable: true }) === c);
check('Object.defineProperty(c, "x", ..)', K25, S25, L25, c => Object.defineProperty(c, "x", { get() { return 21; } }) === c);
check("Object.freeze(c)", K26, S26, L26, c => Object.freeze(c) === c);
check("Object.seal(c)", K27, S27, L27, c => Object.seal(c) === c);
check("Object.preventExtensions(c)", K28, S28, L28, c => Object.preventExtensions(c) === c);
check("Object.isFrozen(c)", K29, S29, L29, c => Object.isFrozen(c));
check("Object.setPrototypeOf(c, q)", K30, S30, L30, c => Object.setPrototypeOf(c, q) === c);
check("Object.setPrototypeOf(c, null)", K31, S31, L31, c => Object.setPrototypeOf(c, null) === c);
check("Object.getPrototypeOf(c)", K32, S32, L32, c => Object.getPrototypeOf(c) === Function.prototype);
check("c.__proto__", K33, S33, L33, c => c.__proto__ === Function.prototype);
check("c.call", K34, S34, L34, c => typeof c.call);
check("c.bind(null)", K35, S35, L35, c => c.bind(null).name);
check("new c()", K36, S36, L36, c => new c().m());
check("Reflect.construct(c, [])", K37, S37, L37, c => Reflect.construct(c, []).m());
check("Reflect.construct(Object, [], c)", K38, S38, L38, c => Object.getPrototypeOf(Reflect.construct(Object, [], c)) === c.prototype);
check("c()", K39, S39, L39, c => c());
check("({}) instanceof c", K40, S40, L40, c => ({}) instanceof c);
check("c[Symbol.hasInstance]", K41, S41, L41, c => typeof c[Symbol.hasInstance]);
check("class extends c", K42, S42, L42, c => {
  const D = class extends c {};
  return [D.s(), D.g, new D().m(), Object.getPrototypeOf(D) === c].join();
});
check("Object.create(c)", K43, S43, L43, c => {
  const child = Object.create(c);
  return [child.s(), child.g, Object.keys(child).length].join();
});
check("Object.assign({}, c)", K44, S44, L44, c => Object.keys(Object.assign({}, c)).length);
check("Object.entries(c)", K45, S45, L45, c => Object.entries(c).length);
check("JSON.stringify(c)", K46, S46, L46, c => JSON.stringify(c));
check("for (name in c)", K47, S47, L47, c => {
  let names = "";
  for (const name in c) names += name;
  return names.length;
});
check('c.hasOwnProperty("s")', K48, S48, L48, c => c.hasOwnProperty("s"));
check('c.propertyIsEnumerable("s")', K49, S49, L49, c => c.propertyIsEnumerable("s"));
check('c.__lookupGetter__("g")', K50, S50, L50, c => typeof c.__lookupGetter__("g"));
check('Reflect.has(c, "prototype")', K51, S51, L51, c => Reflect.has(c, "prototype"));
check('Reflect.get(c, "g", q)', K52, S52, L52, c => Reflect.get(c, "g", q));
check('Reflect.set(c, "s", 9)', K53, S53, L53, c => Reflect.set(c, "s", 9));
check('Reflect.defineProperty(c, "prototype", ..)', K54, S54, L54, c => Reflect.defineProperty(c, "prototype", { value: {} }));
check('Reflect.deleteProperty(c, "g")', K55, S55, L55, c => Reflect.deleteProperty(c, "g"));
check("one name three times", K56, S56, L56, c => {
  const first = Reflect.get(c, "s");
  const second = Reflect.get(c, "s");
  const third = Reflect.get(c, "s");
  return [first === second, second === third, third === Object.getOwnPropertyDescriptor(c, "s").value, first.call(c)].join();
});
check("ten missing names", K57, S57, L57, c => [["a", "b", "d", "e", "f", "h", "i", "j", "k", "n"].every(name => c[name] === undefined), c.s === c.s].join());
check("Error.captureStackTrace(c)", K58, S58, L58, c => [Error.captureStackTrace(c), typeof c.stack].join());
check("new WeakMap([[c, 1]])", K59, S59, L59, c => new WeakMap([[c, 1]]).get(c));
check("structuredClone(c)", K60, S60, L60, c => structuredClone(c));
check("Bun.inspect(c)", K61, S61, L61, c => Bun.inspect(c));
console.log("distinct methods: " + new Set([K1, K2, K3, K4, K5, L1, L2, L3, L4, L5].map(K => K.s)).size);

// Class objects that nothing has touched are alike until their names are asked for, so what one of them answers says nothing about the next.
class Empty {}
class WithOther { static other() { return "other"; } }
class WithOnly { static only() { return "only"; } static other() { return "other of WithOnly"; } }
class AlsoEmpty {}
function readOnly(c) {
  return c.only;
}
function callOther(c) {
  return c.other();
}
console.log("one name in four classes: " + [Empty, WithOther, WithOnly, AlsoEmpty].map(c => typeof readOnly(c)).join());
console.log("the same again: " + [AlsoEmpty, WithOnly, WithOther, Empty].map(c => typeof readOnly(c)).join());
console.log("a method of two classes: " + [WithOther, WithOnly, WithOther].map(c => callOther(c)).join());

class HotFirst { static value() { return 1; } }
class HotSecond { static value() { return 2; } }
class HotThird {}
function callValue(c) {
  return c.value ? c.value() : 0;
}
let sum = 0;
for (let i = 0; i < 30000; i++) sum += callValue(i % 3 === 0 ? HotFirst : i % 3 === 1 ? HotSecond : HotThird);
console.log("three classes in one loop: " + sum);
HotThird.value = () => 4;
HotFirst.value = () => 8;
sum = 0;
for (let i = 0; i < 30000; i++) sum += callValue(i % 3 === 0 ? HotFirst : i % 3 === 1 ? HotSecond : HotThird);
console.log("after two stores: " + sum);

// A name added to Function.prototype is found through a class object that nothing has touched, and a static member of that name hides it.
class FindsInherited {}
class HidesInherited { static addedLater() { return "own"; } }
Function.prototype.addedLater = function () {
  return "inherited by " + this.name;
};
console.log("added to Function.prototype: " + [FindsInherited.addedLater(), HidesInherited.addedLater(), describe(FindsInherited), describe(HidesInherited)].join(", "));
delete Function.prototype.addedLater;
console.log("and deleted: " + [typeof FindsInherited.addedLater, typeof HidesInherited.addedLater].join());

// Classes whose class object cannot wait: the definition itself runs code or gives a name that a function has by itself.
const computed = "computedName";
let ran = "";
class WithStaticField { static field = (ran += "field "); static s() { return 1; } }
class WithStaticBlock { static { ran += "block "; } static s() { return 1; } }
class WithComputedKey { static [computed]() { return 1; } static s() { return 1; } }
class WithSymbolKey { static [Symbol.iterator]() { return 1; } static s() { return 1; } }
class WithIndexKey { static 0() { return 1; } static s() { return 1; } }
class WithName { static name() { return 1; } static s() { return 1; } }
class WithLength { static get length() { return 7; } static s() { return 1; } }
class OverNull extends null { static s() { return 1; } }
class OverObject extends Object { static s() { return 1; } }
console.log("ran: " + ran);
for (const c of [WithStaticField, WithStaticBlock, WithComputedKey, WithSymbolKey, WithIndexKey, WithName, WithLength, OverNull, OverObject])
  console.log(describe(c) + ", s() " + c.s() + ", parent " + (Object.getPrototypeOf(c) === Function.prototype));

function makeClass(result) {
  return class Made { static s() { return result; } m() { return result; } };
}
const made = [makeClass(1), makeClass(2), makeClass(3)];
console.log("one class evaluated three times: " + made.map(c => [c.s(), new c().m(), describe(c)].join()).join(" | ") + ", distinct " + new Set(made.map(c => c.s)).size);
