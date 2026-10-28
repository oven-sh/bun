// Prints the names in the stack trace of an error that is made inside async functions and generators, before and behind their first await or yield. Some have a name of their own, others take one from a variable, a property, a field or a default.
const show = label =>
  console.log(
    label + ":",
    new Error().stack
      .split("\n")
      .slice(2)
      .map(line => line.trim().replace(/ ?\(.*| ?[^\s]*[\\/].*/, ""))
      .join(" | "),
  );

const arrow = async () => {
  show("an arrow in a variable, at first");
  await 0;
  show("an arrow in a variable");
};
const expression = async function () {
  show("a function expression in a variable, at first");
  await 0;
  show("a function expression in a variable");
};
const named = async function own() {
  show("a named function expression, at first");
  await 0;
  show("a named function expression");
};
async function declared() {
  show("a declaration, at first");
  await 0;
  show("a declaration");
}
const holder = {
  async method() {
    show("a method, at first");
    await 0;
    show("a method");
  },
  property: async () => {
    await 0;
    show("an arrow in a property");
  },
  plainProperty: async function () {
    await 0;
    show("a function expression in a property");
  },
  ["computed" + 1]: async () => {
    await 0;
    show("an arrow under a computed key");
  },
  async ["computed" + 2]() {
    await 0;
    show("a method under a computed key");
  },
  *steps() {
    show("a generator method, at first");
    yield 1;
    show("a generator method");
  },
};
class Holder {
  static async staticMethod() {
    await 0;
    show("a static method");
  }
  field = async () => {
    await 0;
    show("an arrow in a field");
  };
  static staticField = async function () {
    await 0;
    show("a function expression in a static field");
  };
  async #hidden() {
    await 0;
    show("a private method");
  }
  callHidden() {
    return this.#hidden();
  }
}
let assigned;
assigned = async () => {
  await 0;
  show("an arrow that is assigned");
};
const takeDefault = ({ byDefault = async () => (await 0, show("an arrow that is a default")) }) => byDefault;
const outerArrow = async () => {
  await declared();
  show("an arrow that awaited a declaration");
};
async function outerDeclared() {
  await arrow();
  show("a declaration that awaited an arrow");
}
function* declaredSteps() {
  show("a generator declaration, at first");
  yield 1;
  show("a generator declaration");
}
const stepsExpression = function* () {
  show("a generator expression in a variable, at first");
  yield 1;
  show("a generator expression in a variable");
};
const namedSteps = function* ownSteps() {
  yield 1;
  show("a named generator expression");
};
const plainArrow = () => show("an arrow that is not async");
const plainExpression = function () {
  show("a function expression that is not async");
};

await arrow();
await expression();
await named();
await declared();
await holder.method();
await holder.property();
await holder.plainProperty();
await holder.computed1();
await holder.computed2();
await Holder.staticMethod();
await new Holder().field();
await Holder.staticField();
await new Holder().callHidden();
await assigned();
await takeDefault({})();
await outerArrow();
await outerDeclared();
for (const step of holder.steps());
for (const step of declaredSteps());
for (const step of stepsExpression());
for (const step of namedSteps());
plainArrow();
plainExpression();
await (async () => {
  await 0;
  show("an arrow without a name");
})();
console.log(arrow.name, expression.name, holder.property.name, stepsExpression.name, assigned.name);
