// What the formatter looks for by name it finds on a function too: a custom inspect method, toJSON for %j, toString for %s.
// Flags: --aot-validate
const custom = Symbol.for("nodejs.util.inspect.custom");
const seen = [];
function shown() {}
shown[custom] = function (depth, options, inspect) {
  seen.push(this === shown, typeof depth, typeof options, typeof inspect);
  return { from: "custom", inner: { [custom]: () => "inner custom" } };
};
console.log(shown, [shown]);
console.log(seen.join());

function asData() {}
asData.toJSON = function () {
  seen.push(this === asData);
  return { from: "toJSON" };
};
console.log("%j", asData);

function asText() {}
asText.toString = function () {
  seen.push(this === asText);
  return "from toString";
};
console.log("%s", asText);

function inherits() {}
Object.setPrototypeOf(inherits, {
  __proto__: Function.prototype,
  [custom]() {
    seen.push(this === inherits);
    return "from above";
  },
});
console.log(inherits, seen.length, seen.every(one => one !== false));
