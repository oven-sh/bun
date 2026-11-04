// An enum member in the place of a callee or of a template's tag. `bun build` has the value in place there too, so an executable calls the member's value, which throws, with `--aot` and without. What TypeScript's compiler emits calls what the program has stored in the object.
// Reference: bun build --compile
function attempt(read: () => unknown) {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
}
type Callable = () => string;
type Tag = (texts: TemplateStringsArray) => string;

enum Plain {
  A = 1,
  Text = "text",
}
namespace Outer {
  export enum Inner {
    A = 1,
  }
}

console.log(
  "nothing stored",
  attempt(() => (Plain.A as unknown as Callable)()),
  attempt(() => (Plain.Text as unknown as Callable)()),
  attempt(() => (Outer.Inner.A as unknown as Callable)()),
  attempt(() => (Plain.A as unknown as Tag)``),
);

function stored(this: unknown) {
  return this === Plain ? "called on Plain" : this === Outer.Inner ? "called on Inner" : "called";
}
(Plain as Record<string, unknown>).A = stored;
(Plain as Record<string, unknown>).Text = stored;
(Outer.Inner as Record<string, unknown>).A = stored;

console.log(
  "called",
  attempt(() => (Plain.A as unknown as Callable)()),
  attempt(() => (Plain["A"] as unknown as Callable)()),
  attempt(() => (Plain.Text as unknown as Callable)()),
);
console.log(
  "called, in a namespace",
  attempt(() => (Outer.Inner.A as unknown as Callable)()),
  attempt(() => (Outer["Inner"].A as unknown as Callable)()),
  attempt(() => (Outer["Inner"]["A"] as unknown as Callable)()),
);
console.log(
  "a tag",
  attempt(() => (Plain.A as unknown as Tag)``),
  attempt(() => (Plain.Text as unknown as Tag)``),
  attempt(() => (Outer.Inner.A as unknown as Tag)``),
  attempt(() => (Outer["Inner"].A as unknown as Tag)``),
);
