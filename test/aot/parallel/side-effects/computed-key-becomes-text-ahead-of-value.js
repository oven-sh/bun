// Prints when a computed key that is an object becomes a text: ahead of the value of its member, in literals, classes, assignments and patterns. Plain Bun prints another output.
const order = [];
function tell(label, value) {
  order.push(label);
  return value;
}
function named(text) {
  return {
    toString() {
      order.push("key to text");
      return text;
    },
  };
}
function scene(label, run) {
  order.length = 0;
  run();
  console.log(label + ":", order.join(" < "));
}
scene("a value in a literal", () => ({ [named("a")]: tell("value", 1) }));
scene("two values in a literal", () => ({ [named("a")]: tell("value", 1), [named("b")]: tell("value", 2) }));
scene("a key that is made by a call", () => ({ [tell("key", named("a"))]: tell("value", 1) }));
scene("a function in a literal", () => ({ [named("a")]: tell("value", () => {}) }));
scene(
  "a field of a class",
  () =>
    new (class {
      [named("a")] = tell("value", 1);
    })(),
);
scene(
  "a static field of a class",
  () =>
    class {
      static [named("a")] = tell("value", 1);
    },
);
scene(
  "two static fields of a class",
  () =>
    class {
      static [named("a")] = tell("value", 1);
      static [named("b")] = tell("value", 2);
    },
);
scene("an assignment", () => ({}[named("a")] = tell("value", 1)));
scene("a pattern", () => {
  const { [named("a")]: held = tell("default", 1) } = {};
});
/* Output:
a value in a literal: key to text < value
two values in a literal: key to text < value < key to text < value
a key that is made by a call: key < key to text < value
a function in a literal: key to text < value
a field of a class: key to text < value
a static field of a class: key to text < value
two static fields of a class: key to text < key to text < value < value
an assignment: value < key to text
a pattern: key to text < default
*/
