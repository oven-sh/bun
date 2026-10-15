// A parameter that is a destructuring pattern without an annotation: TypeScript infers a type from the names in the pattern. That type is inferred, not annotated, so anything that has the properties is accepted, even if an object type of the program happens to match it.
type Action = { type: "load" | "defer"; path: string };
const actions: Action[] = [];
actions.push({ type: "load", path: "made/by/the/program.ts" });

function given(): any {
  const object = Object.create({ inherited: "from the prototype" });
  object.path = "/a/b.ts";
  object.defer = () => "deferred";
  return object;
}
function calls(f: any, ...rest: unknown[]) {
  return f(given(), ...rest);
}
class Entry {
  path = "/an/instance.ts";
}

const arrow = ({ path }) => path.split("/").pop();
const asyncArrow = async ({ path }) => path.length;
function declaration({ path }) {
  return path.toUpperCase();
}
const withDefaults = ({ path = "none", type = "load" }) => type + " " + path;
const wholeDefault = ({ path = "none" } = {}) => path;
const nested = ({ defer, inherited }) => [defer(), inherited];
const second = (first: number, { path }) => first + path.length;
const list = ([first, next]) => [next, first];
const holder = {
  method({ path }) {
    return "method " + path;
  },
};
class Loader {
  load({ path }) {
    return "load " + path;
  }
}

const row = (name: string, ...values: unknown[]) => console.log(name + ": " + JSON.stringify(values));
row("arrow", calls(arrow));
row("async arrow", await calls(asyncArrow));
row("declaration", calls(declaration));
row("defaults", calls(withDefaults), withDefaults({}), withDefaults({ type: "defer" }));
row("a default for the whole", calls(wholeDefault), wholeDefault(), wholeDefault({ path: "p" }));
row("a function and an inherited property", calls(nested));
row("second", (second as any)(1, given()));
row("an array pattern", (list as any)("ab"), list([1, 2]), (list as any)(new Set([3, 4])));
row("a method of a literal", calls(holder.method));
row("a method of a class", calls(new Loader().load));
row("objects of the program", arrow(actions[0]), arrow(new Entry()), arrow({ path: "a/literal.ts" }));
row("objects of the engine", (({ size }) => size)(new Set([1, 2])), (({ message }) => message)(new Error("said")), (({ length }) => length)("abc"), calls(({ path }) => typeof path));
try {
  (arrow as any)(undefined);
} catch (e) {
  row("undefined", (e as Error).constructor.name);
}
