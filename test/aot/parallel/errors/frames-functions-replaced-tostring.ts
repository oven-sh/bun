// Function.prototype.toString is replaced, first by a method and then by an accessor. Both keep the function object they are run on. A function makes a function object, converts it to a text or a number or reads its toString, renames what was kept, and calls the function object. Each is made three times: renamed, left alone, renamed otherwise. Prints what the frames call each of them.
let kept: Function;
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
function run(outer: (name: string) => void): void {
  for (const name of ["first", "", "second"]) {
    try {
      outer(name);
    } catch (error) {
      console.log(frames(error));
    }
  }
}
const table: Record<string, number> = { text: 1 };
function runAll(): void {
  run(function addsToText(name) {
    const made: any = function written1() {
      throw new Error("x");
    };
    const text = "" + made;
    rename(kept, name);
    made();
  });
  run(function putsInTemplate(name) {
    const made: any = function written2() {
      throw new Error("x");
    };
    const text = `${made}`;
    rename(kept, name);
    made();
  });
  run(function comparesLoosely(name) {
    const made: any = function written3() {
      throw new Error("x");
    };
    const same = made == "text";
    rename(kept, name);
    made();
  });
  run(function readsUnderIt(name) {
    const made: any = function written4() {
      throw new Error("x");
    };
    const found = table[made];
    rename(kept, name);
    made();
  });
  run(function comparesBySize(name) {
    const made: any = function written5() {
      throw new Error("x");
    };
    const less = made < 1;
    rename(kept, name);
    made();
  });
  run(function makesNumber(name) {
    const made: any = function written6() {
      throw new Error("x");
    };
    const number = +made;
    rename(kept, name);
    made();
  });
  run(function callsString(name) {
    const made: any = function written7() {
      throw new Error("x");
    };
    const text = String(made);
    rename(kept, name);
    made();
  });
  run(function readsToString(name) {
    const made: any = function written8() {
      throw new Error("x");
    };
    made.toString;
    rename(kept, name);
    made();
  });
}
Function.prototype.toString = function () {
  kept = this;
  return "text";
};
runAll();
const method = Function.prototype.toString;
Object.defineProperty(Function.prototype, "toString", {
  get() {
    kept = this;
    return method;
  },
  configurable: true,
});
runAll();
