// A parameter without a written type whose default value is an object literal: TypeScript takes the type of the literal for the type of the parameter. Nobody wrote that type, so an object from untyped code that has the properties is taken as it is.
type Made = { depth: number; name: string };
const made: Made[] = [{ depth: 3, name: "made by the program" }];
function given(): any {
  const object = Object.create({ inherited: 1 });
  object.depth = 2;
  object.extra = () => 1;
  return object;
}
const row = (name: string, f: () => unknown) => {
  let r: unknown;
  try {
    r = f();
  } catch (e) {
    r = "THROWS " + (e as Error).constructor.name;
  }
  console.log(name + ": " + JSON.stringify(r));
};
const arrow = (options = { depth: 1 }) => options.depth;
function declaration(options = { depth: 1 }) {
  return options.depth;
}
const empty = (options = {}) => Object.keys(options).length;
const second = (first: number, options = { depth: 1 }) => first + options.depth;
const nested = (options = { inner: { depth: 1 } }) => options.inner.depth;
class Walker {
  walk(options = { depth: 1 }) {
    return options.depth * 2;
  }
}
row("an arrow function", () => (arrow as any)(given()));
row("a declaration", () => (declaration as any)(given()));
row("an empty literal", () => [(empty as any)(given()), empty(), empty({ a: 1 })]);
row("the second parameter", () => (second as any)(1, given()));
row("a literal in the literal", () => (nested as any)({ inner: given() }));
row("a method", () => (new Walker().walk as any)(given()));
row("as the type says", () => [arrow(), arrow({ depth: 5 }), arrow(made[0]), declaration(undefined), nested(), new Walker().walk({ depth: 4 })]);
row("without the property", () => (arrow as any)({}));
row("null", () => (arrow as any)(null));
