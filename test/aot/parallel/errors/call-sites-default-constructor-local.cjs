// Prints the call sites of a default constructor that hands its arguments on, and the frames under a local variable that is named Reflect.
function Thrower() {
  throw new Error("thrown");
}
class Base {
  constructor() {
    throw new Error("thrown");
  }
}
function listSites(run) {
  Error.prepareStackTrace = (error, sites) => sites.slice(0, 4).map(site => site.getFunctionName() + " " + site.getLineNumber() + ":" + site.getColumnNumber()).join(" < ");
  try {
    run();
  } catch (error) {
    return error.stack;
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
  defaultConstructor() { class Derived extends Base {} new Derived(2); },
  defaultConstructorWithField() { class Derived extends Base { field = 1; } new Derived(2); },
  twoDefaultConstructors() { class Middle extends Base {} class Derived extends Middle {} new Derived(); },
  defaultConstructorOfExpression() { new (class extends Base {})(1); },
  localNamedReflect() { const Reflect = globalThis.Reflect; const made = Reflect.construct(Thrower, []); return made; },
  localNamedReflectUsedTwice() { const Reflect = globalThis.Reflect; Reflect.has({}, "x"); const made = Reflect.construct(Thrower, []); return made; },
  parameterNamedReflect(Reflect = globalThis.Reflect) { const made = Reflect.construct(Thrower, []); return made; },
  written() { const made = Reflect.construct(Thrower, []); return made; },
  writtenWithAConstantKey() { const key = "construct"; const made = Reflect[key](Thrower, []); return made; },
  writtenWithAConstantKeyUsedTwice() { const key = "construct"; const made = Reflect[key](Thrower, [key]); return made; },
  writtenWithAKeyThatChanges() { let key = "has"; key = "construct"; const made = Reflect[key](Thrower, []); return made; },
  writtenWithAConstantKeyBehindACall() { String(1); const key = "construct"; const made = Reflect[key](Thrower, [key]); return made; },
};
for (const [name, form] of Object.entries(forms)) console.log(name, "|", listSites(form), "|", listNames(form));
