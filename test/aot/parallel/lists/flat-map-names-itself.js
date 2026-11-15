// The errors of flatMap itself name flatMap as native code, and what its callback throws names no frame of flatMap.
const say = (name, act) => {
  try {
    console.log(name, "fine", JSON.stringify(act()));
  } catch (error) {
    const frames = String(error.stack).split("\n").slice(1).map(line => line.trim().replace(/\(?\S*flat-map-names-itself\.js:\d+:\d+\)?/, "F"));
    console.log(name, error.message, frames.join(" | "));
  }
};
for (let turn = 0; turn < 3; turn++) {
  say("callback", () => [1, 2].flatMap(x => { throw new Error("a"); }));
  say("callback of inner", () => [1, 2].flatMap(x => [x].flatMap(y => { throw new Error("i"); })));
  say("no callback", () => [1, 2].flatMap());
  say("number", () => [1, 2].flatMap(5));
  say("null", () => Array.prototype.flatMap.call(null, x => x));
  say("undefined", () => Array.prototype.flatMap.call(undefined, x => x));
  say("text", () => Array.prototype.flatMap.call("ab", x => [x, x]));
  say("object", () => Array.prototype.flatMap.call({ length: 1, 0: 1 }, x => { throw new Error("b"); }));
  say("object without callback", () => Array.prototype.flatMap.call({ length: 1, 0: 1 }, {}));
  say("length", () => Array.prototype.flatMap.call({ get length() { throw new Error("l"); } }, x => x));
  say("hole", () => [, 1].flatMap(x => { throw new Error("c"); }));
  say("doubles", () => [1.5, 2.5].flatMap(x => { throw new Error("d"); }));
  say("species", () => { const list = [1]; list.constructor = { [Symbol.species]: function () { throw new Error("s"); } }; return list.flatMap(x => x); });
  say("species that is no constructor", () => { const list = [1]; list.constructor = { [Symbol.species]: 5 }; return list.flatMap(x => x); });
  say("getter", () => { const list = [1]; Object.defineProperty(list, 1, { get() { throw new Error("g"); } }); return list.flatMap(x => x); });
  say("proxy", () => [1].flatMap(x => new Proxy([], { get() { throw new Error("p"); } })));
  say("this", () => [1, 2].flatMap(function (x, i, list) { return [this.k + x, i, list.length]; }, { k: 10 }));
  say("grows", () => { const list = [1, 2]; return list.flatMap(x => (list.length < 4 && list.push(9), [x, [x]])); });
  say("shrinks", () => { const list = [1, 2, 3]; return list.flatMap(x => (list.length = 2, x)); });
  say("inner holes", () => [1, 2].flatMap(x => [x, , x]));
  say("by value", () => { const { flatMap } = Array.prototype; return flatMap.call([1, 2], x => [x, -x]); });
  say("apply", () => Array.prototype.flatMap.apply([3], [x => [x], null]));
}
console.log(Array.prototype.flatMap.name, Array.prototype.flatMap.length, String(Array.prototype.flatMap).includes("[native code]"));
