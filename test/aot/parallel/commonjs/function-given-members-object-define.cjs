// A function gets members by `Object.defineProperty`, as a maker of constructors does, and they are read and called afterwards.
function makeConstructor(name, initialize) {
  function init(instance, definition) {
    if (!instance.state)
      Object.defineProperty(instance, "state", { value: { definition, traits: new Set() }, enumerable: false });
    instance.state.traits.add(name);
    initialize(instance, definition);
  }
  function Made(definition) {
    init(this, definition);
    return this;
  }
  Object.defineProperty(Made, "init", { value: init });
  Object.defineProperty(Made, "label", { value: name });
  return Made;
}
const Text = makeConstructor("Text", (instance, definition) => {
  instance.check = value => typeof value === "string" && value.length >= definition.least;
});
const Named = makeConstructor("Named", (instance, definition) => {
  Text.init(instance, definition);
  instance.title = definition.title;
});
const named = new Named({ least: 2, title: "name" });
console.log(
  named.check("ab"),
  named.check("a"),
  named.title,
  [...named.state.traits].join(),
  Named.label,
  Text.label,
  Object.keys(named).join(),
);
