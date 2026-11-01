// A function makes a function object, hands it to text that is put together at run time, renames what comes back by a definition of `name`, and calls the function object it made. Each is made three times: renamed, left alone, renamed otherwise. Prints what the frames call each of them.
const handBack = new Function("x", ["return", "x"].join(" ")) as (x: unknown) => any;
let kept: any;
function frames(error: unknown): string {
  return (error as Error)
    .stack!.split("\n")
    .slice(1, 3)
    .map(line => line.trim().split(" ")[1])
    .join(" < ");
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
run(function definesProperty(name) {
  const made = function written1() {
    throw new Error("x");
  };
  const back = handBack(made);
  if (name) Object.defineProperty(back, "name", { value: name });
  made();
});
run(function definesProperties(name) {
  const made = function written2() {
    throw new Error("x");
  };
  const back = handBack(made);
  if (name) Object.defineProperties(back, { name: { value: name } });
  made();
});
run(function definesByReflect(name) {
  const made = function written3() {
    throw new Error("x");
  };
  const back = handBack(made);
  if (name) Reflect.defineProperty(back, "name", { value: name });
  made();
});
run(function definesOutOfHolder(name) {
  const made = function written4() {
    throw new Error("x");
  };
  const back = handBack({ made });
  if (name) Object.defineProperty(back.made, "name", { value: name });
  made();
});
run(function definesInHelper(name) {
  const made = () => {
    throw new Error("x");
  };
  const rename = (given: any) => Object.defineProperty(given, "name", { value: name });
  if (name) rename(handBack(made));
  made();
});
Function.prototype.toString = function () {
  kept = this;
  return "text";
};
run(function definesWhatConversionKept(name) {
  const made = function written6() {
    throw new Error("x");
  };
  const text = "" + made;
  if (name) Object.defineProperty(kept, "name", { value: name });
  made();
});
