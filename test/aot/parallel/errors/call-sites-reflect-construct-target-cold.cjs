// Prints the call sites of Reflect.construct(target, list) where the target is handed in: a constructor that throws, and values that cannot be constructed.
// Flags: --aot-heat=everything-is-cold
function Thrower() {
  throw new Error("thrown");
}
class Derived extends Thrower {}
function listSites(run) {
  Error.prepareStackTrace = (error, sites) => sites.slice(0, 4).map(site => site.getFunctionName() + " " + site.getLineNumber() + ":" + site.getColumnNumber()).join(" < ");
  try {
    run();
  } catch (error) {
    return error.constructor.name + " " + error.stack;
  } finally {
    Error.prepareStackTrace = undefined;
  }
}
function listNames(run) {
  try {
    run();
  } catch (error) {
    return String(error.stack).split("\n").slice(1, 5).map(line => /at (?:(.*?) \(|)/.exec(line)[1] ?? "-").join(" < ");
  }
}
const forms = {
  twoArguments(target) { const made = Reflect.construct(target, []); return made; },
  threeArguments(target) { const made = Reflect.construct(Thrower, [], target); return made; },
  listHandedIn(target, list) { const made = Reflect.construct(target, list); return made; },
  inTailPosition(target) { return Reflect.construct(target, []); },
  inATry(target) { try { return Reflect.construct(target, [1]); } finally { String(target); } },
  twice(target) { const made = [Reflect.construct(Object, []), Reflect.construct(target, [])]; return made; },
};
const targets = { Thrower, Derived, arrow: () => {}, nothing: undefined, text: "text", bound: Thrower.bind(null), proxy: new Proxy(Thrower, {}) };
for (const [name, form] of Object.entries(forms)) {
  for (const [kind, target] of Object.entries(targets)) console.log(name, kind, "|", listSites(() => form(target, [])), "|", listNames(() => form(target, [])));
  console.log(name, "no list |", listSites(() => form(Thrower, 1)), "|", listNames(() => form(Thrower, 1)));
}
