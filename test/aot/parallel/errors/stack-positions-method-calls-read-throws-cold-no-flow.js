// Prints where a stack trace places a method call `object.method()`: at the read where the receiver is null or undefined and while a getter runs, at the call where what was read is no function and while the method runs.
// The text that is never evaluated keeps the compiler from knowing what else runs, so nothing is known about the receivers.
// Flags: --aot-heat=everything-is-cold --aot-disable=flow-results
if (process.argv.length > 1000) (0, eval)(process.argv[1000]);
const inThisFile = /stack-positions-of-method-calls-whose-read-throws-or-runs-a-getter/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    console.log(label, "|", run());
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
const nothing = null;
const missing = undefined;
const throwsInGetter = { get method() { throw new Error("getter"); } };
const looksInGetter = { get method() { const places = placesOf(new Error("look")).slice(0, -2).join(" "); return () => places; } };
const throwsInMethod = { method() { throw new Error("method"); } };
const looksInMethod = { method() { return placesOf(new Error("look")).slice(0, -2).join(" "); } };
const holdsNumber = { method: 5 };
const holdsNothing = {};
const inherits = Object.create(throwsInGetter);
const behindProxy = new Proxy({}, { get() { throw new Error("trap"); } });
const table = { nothing, missing, throwsInGetter, looksInGetter, throwsInMethod, looksInMethod, holdsNumber, holdsNothing, inherits, behindProxy, text: "text", number: 5 };

show("nothing.method();", () => { nothing.method(); });
show("missing.method();", () => { missing.method(); });
show("throwsInGetter.method();", () => { throwsInGetter.method(); });
show("return looksInGetter.method();", () => { const places = looksInGetter.method(); return places; });
show("throwsInMethod.method();", () => { throwsInMethod.method(); });
show("return looksInMethod.method();", () => { const places = looksInMethod.method(); return places; });
show("holdsNumber.method();", () => { holdsNumber.method(); });
show("holdsNothing.method();", () => { holdsNothing.method(); });
show("inherits.method();", () => { inherits.method(); });
show("behindProxy.method();", () => { behindProxy.method(); });

function withoutArguments(object) {
  const result = object.method();
  return result;
}
function withOneArgument(object) {
  const result = object.method(1);
  return result;
}
function withFourArguments(object) {
  const result = object.method(1, "two", object, [4]);
  return result;
}
function onTwoLines(object) {
  const result = object
    .method();
  return result;
}
function behindAnotherRead(holder) {
  const result = holder.object.method();
  return result;
}
function inATry(object) {
  try {
    const result = object.method();
    return result;
  } catch (error) {
    return error.constructor.name + " caught " + placesOf(error).slice(0, -3).join(" ");
  }
}
class Caller {
  constructor(object) {
    this.object = object;
  }
  call() {
    const result = this.object.method();
    return result;
  }
}
for (const key of Object.keys(table)) {
  const object = table[key];
  show("withoutArguments " + key, () => withoutArguments(object));
  show("withOneArgument " + key, () => withOneArgument(object));
  show("withFourArguments " + key, () => withFourArguments(object));
  show("onTwoLines " + key, () => onTwoLines(object));
  show("behindAnotherRead " + key, () => behindAnotherRead({ object }));
  show("inATry " + key, () => inATry(object));
  show("Caller " + key, () => new Caller(object).call());
}
