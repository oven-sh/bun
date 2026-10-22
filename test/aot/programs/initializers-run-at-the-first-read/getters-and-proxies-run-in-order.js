// What an initializer reads may run code.
const log = [];
const source = { get a() { log.push("get a"); return 1; }, b: 2 };
const proxy = new Proxy({}, { get(t, k) { log.push("trap " + String(k)); return 7; }, ownKeys() { log.push("ownKeys"); return []; }, has(t, k) { log.push("has " + String(k)); return true; } });
const fromGetter = { v: source.a };
const fromProxy = { v: proxy.x };
const spreadGetter = { ...source };
const spreadProxy = { ...proxy };
const inProxy = ["y" in proxy];
const withKey = { [{ toString() { log.push("key"); return "k"; } }]: 1 };
const withValueOf = [+{ valueOf() { log.push("valueOf"); return 3; } }];
const template = [`${{ toString() { log.push("template"); return "t"; } }}`];
const iterated = [...{ *[Symbol.iterator]() { log.push("iterate"); yield 1; } }];
const mapped = new Map({ *[Symbol.iterator]() { log.push("map iterate"); yield [1, 2]; } });
const destructured = (({ a }) => [a])(source);
class WithStatic { static x = (log.push("static field"), 1); static { log.push("static block"); } [(log.push("computed name"), "m")]() {} }
class Below extends (log.push("heritage"), WithStatic) {}
const tagged = ((s) => (log.push("tag"), [s]))`x`;
const defined = Object.defineProperty({}, "p", { get value() { log.push("descriptor"); return 1; } });
const assigned = Object.assign({}, source);
const frozen = Object.freeze({ a: 1 });
log.push("end of the module");
function main() {
  console.log(log.join(" | "));
  console.log(fromGetter.v, fromProxy.v, spreadGetter.a, Object.keys(spreadProxy).length, inProxy[0], withKey.k, withValueOf[0], template[0], iterated[0], mapped.get(1), destructured[0], WithStatic.x, typeof Below, tagged[0][0], defined.p, assigned.a, Object.isFrozen(frozen));
  console.log(log.join(" | "));
}
main();
