// No object crosses the border of a ShadowRealm. What a function of the realm throws, an error, a literal, a function or a number, reaches whoever called it as a TypeError of the caller's realm:
// compiled code, a built-in that calls it back, a getter, a conversion, a promise job. And the other way: what an outer callback throws is a TypeError of the inner realm in there.
const realm = new ShadowRealm();
function kind(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return "the primitive " + String(value);
  if (value instanceof TypeError && Object.getPrototypeOf(value) === TypeError.prototype) return "a TypeError of the outer realm";
  if (value instanceof Object) return "an outer " + (value.name ?? typeof value);
  return "AN OBJECT OF THE INNER REALM (" + (() => { try { return String(value.name ?? typeof value); } catch { return "?"; } })() + ")";
}
const lines = [];
function attempt(title, run) {
  try { lines.push(title + ": answered " + kind(run())); } catch (error) { lines.push(title + ": caught " + kind(error)); }
}
const throwsError = realm.evaluate("() => { throw new RangeError('inner'); }");
const throwsNumber = realm.evaluate("() => { throw 7; }");
const throwsLiteral = realm.evaluate("() => { throw { secret: 1 }; }");
const throwsFunction = realm.evaluate("() => { throw function leaked() {}; }");
const throwsInGetter = realm.evaluate("() => ({ get x() { throw new RangeError('getter'); } }).x");
const overflows = realm.evaluate("function deep() { return deep() + 1; } deep");
const throwsNative = realm.evaluate("() => null.x");
const boundInside = realm.evaluate("(function () { throw new RangeError('bound'); }).bind(null)");
const nativeInside = realm.evaluate("JSON.parse");
const proxyInside = realm.evaluate("new Proxy(function () {}, { apply() { throw new RangeError('trap'); } })");
const givesThrower = realm.evaluate("() => () => { throw new RangeError('second'); }");
for (const [name, thrower] of Object.entries({ throwsError, throwsNumber, throwsLiteral, throwsFunction, throwsInGetter, overflows, throwsNative, boundInside, proxyInside })) attempt(name + "()", () => thrower());
attempt("nativeInside('{')", () => nativeInside("{"));
attempt("givesThrower()()", () => givesThrower()());
attempt("call", () => throwsError.call(undefined));
attempt("apply", () => throwsError.apply(undefined, []));
attempt("Reflect.apply", () => Reflect.apply(throwsError, undefined, []));
attempt("Reflect.apply of the bound one", () => Reflect.apply(boundInside, undefined, []));
attempt("bind", () => throwsError.bind(undefined)());
attempt("forEach", () => [0].forEach(throwsError));
attempt("map", () => [0].map(throwsError));
attempt("sort", () => [2, 1].sort(throwsError));
attempt("replace", () => "x".replace(/x/, throwsError));
attempt("replace by a text", () => "x".replace("x", throwsError));
attempt("JSON.parse", () => JSON.parse("1", throwsError));
attempt("JSON.stringify", () => JSON.stringify({ a: 1 }, throwsError));
attempt("Map.forEach", () => new Map([[1, 1]]).forEach(throwsError));
attempt("a getter that is the thrower", () => Object.defineProperty({}, "x", { get: throwsError }).x);
attempt("valueOf", () => +{ valueOf: throwsError });
attempt("toString", () => `${{ toString: throwsError }}`);
attempt("an iterator's next", () => [...{ [Symbol.iterator]: () => ({ next: throwsError }) }]);
attempt("a proxy's trap", () => new Proxy({}, { get: throwsError }).x);
attempt("through any", () => { const anything = [throwsError, 1][Number(process.argv.length > 50)]; return anything(); });
attempt("evaluate throws", () => realm.evaluate("throw new RangeError('while evaluating')"));
attempt("evaluate of bad syntax", () => realm.evaluate("]"));
attempt("evaluate gives an object", () => realm.evaluate("({})"));
attempt("an object as an argument", () => realm.evaluate("(a) => a")({}));
attempt("an async function of the realm", () => realm.evaluate("async () => 1")());
const callsBack = realm.evaluate("(f) => { try { f(); return 'no throw'; } catch (e) { return [e instanceof TypeError, Object.getPrototypeOf(e) === TypeError.prototype, e instanceof Object].join(); } }");
attempt("a callback that throws, caught inside", () => callsBack(() => { throw new RangeError("outer"); }));
attempt("a callback that throws a literal, caught inside", () => callsBack(() => { throw { secret: 2 }; }));
attempt("a callback that throws, not caught inside", () => realm.evaluate("(f) => f()")(() => { throw new RangeError("outer"); }));
const settled = async (title, promise) => { try { lines.push(title + ": resolved " + kind(await promise)); } catch (error) { lines.push(title + ": rejected " + kind(error)); } };
await settled("new Promise(thrower)", new Promise(throwsError));
await settled("then(thrower)", Promise.resolve(1).then(throwsError));
await settled("an async caller", (async () => throwsError())());
await settled("importValue of nothing", realm.importValue("./there-is-no-such-module.mjs", "x"));
console.log(lines.join("\n"));
