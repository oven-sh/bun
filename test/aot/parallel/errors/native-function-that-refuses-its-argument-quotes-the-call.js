// `Object.keys(null)`: the function throws out of the engine's own C++, and the message quotes the call as it is written in the frame that a stack trace lists first.
function show(name, run) {
  try {
    run();
    console.log(name, "no error");
  } catch (error) {
    console.log(name + ":", error.name + ": " + error.message);
  }
}
// An executable keeps the text of a function that something may ask for it.
globalThis.shown = show;
const o = { deep: { keys: Object.keys } };
const keys = Object.keys;
const nothing = () => null;

show("a static method", () => {
  Object.keys(null);
});
show("on one line", () => { Object.keys(null); });
show("undefined", () => { Object.keys(nothing()?.absent); });
show("through call", () => { Array.prototype.push.call(null, 1); });
show("through apply", () => { Array.prototype.push.apply(null, [1]); });
show("inside another call", () => { String(Object.keys(null)); });
show("the inner of two alike", () => { Object.keys(Object.keys(null)); });
show("the outer of two alike", () => { Object.keys(nothing(Object.keys({}))); });
show("a path", () => { o.deep.keys(null); });
show("a path with brackets", () => { o["deep"].keys(null); });
show("optional", () => { o.deep?.keys?.(null); });
show("a bare name", () => { keys(null); });
show("over two lines", () => {
  Object.keys(
    null);
});
show("spread", () => { Object.keys(...[null]); });
show("behind characters that are not ASCII", () => { const text = "äöü 𝒳"; return [text, Object.keys(null)]; });
show("two on a line, the second", () => { Object.keys({}); Object.entries(null); });
show("in an argument of a method", () => { [1].concat(Object.values(null)); });

// A frame that left by a tail call is not there, so the call in the frame below is quoted.
function pushAll(target, source) { return Array.prototype.push.apply(target, source); }
const run = () => pushAll(null, [1]);
show("behind two tail calls", () => { run(); });
show("the callback leaves by a tail call", () => Object.keys(null));
const byKey = { keys: value => Object.keys(value), has: value => [Object.hasOwn(value, "a")] };
show("called under a key, and leaves by a tail call", () => { for (const key of ["keys"]) byKey[key](null); });
show("called under a key", () => { for (const key of ["has"]) byKey[key](undefined); });

// These say what is wrong in their own words.
show("map", () => { Array.prototype.map.call(null, x => x); });
show("ownKeys", () => { Reflect.ownKeys(1); });
show("has", () => { Set.prototype.has.call({}, 1); });
