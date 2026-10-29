// A function makes a function object, reads its `prototype`, renames what the `constructor` of that object holds, and calls the function object. Each is made three times: renamed, left alone, renamed otherwise. Prints what the frames call each of them.
let kept: { constructor: Function };
function frames(error: unknown): string {
  return (error as Error)
    .stack!.split("\n")
    .slice(1, 3)
    .map(line => line.trim().split(" ")[1])
    .join(" < ");
}
function rename(made: Function, name: string): void {
  if (name) Object.defineProperty(made, "name", { value: name });
}
function renameThrough(prototype: { constructor: Function }, name: string): void {
  rename(prototype.constructor, name);
}
function run(outer: (name: string) => void): void {
  for (const name of ["first", "", "second"]) {
    try {
      outer(name);
    } catch (error) {
      console.log(frames(error));
    }
  }
}
run(function renamesOnTheSpot(name) {
  const made = function written1() {
    throw new Error("x");
  };
  const prototype = made.prototype;
  rename(prototype.constructor, name);
  made();
});
run(function handsThePrototypeOn(name) {
  const made = function written2() {
    throw new Error("x");
  };
  renameThrough(made.prototype, name);
  made();
});
run(function storesDisplayName(name) {
  const made = function written3() {
    throw new Error("x");
  };
  if (name) made.prototype.constructor.displayName = name;
  made();
});
run(function keepsThePrototype(name) {
  const made = function written4() {
    throw new Error("x");
  };
  kept = made.prototype;
  rename(kept.constructor, name);
  made();
});
