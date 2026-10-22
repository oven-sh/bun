// No object crosses the border of a ShadowRealm. What a function of the realm throws reaches its caller as a TypeError of the caller's realm.
const realm = new ShadowRealm();
const describe = run => { try { return "answered " + String(run()); } catch (error) { return [error instanceof TypeError ? "the outer TypeError" : error instanceof Error ? "an outer " + error.name : "AN ERROR OF THE INNER REALM: " + error.name, String(error.message).slice(0, 40)].join(": "); } };
const thrower = realm.evaluate("() => { throw new RangeError('inner'); }");
console.log(String(thrower), describe(() => thrower()));
const made = realm.evaluate(["() => {", "throw new RangeError('inner, text made at run time');", "}"].join(" "));
console.log(describe(() => made()));
console.log(describe(() => realm.evaluate("throw new RangeError('while evaluating')")));
console.log(describe(() => realm.evaluate("({})")));
const adds = realm.evaluate("(a, b) => a + b");
console.log(adds(1, 2), describe(() => adds({}, 1)));
