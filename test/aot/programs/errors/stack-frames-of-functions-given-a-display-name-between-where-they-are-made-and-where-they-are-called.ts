// A function makes a function object, stores a displayName in it or deletes its name, and calls it. Each is made three times: with one name, with none, with another. Prints what the frames call each function object.
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
const keys = ["displayName", "name"];
run(function storesByName(name) {
  const made: any = function written1() {
    throw new Error("x");
  };
  if (name) made.displayName = name;
  made();
});
run(function storesUnderKey(name) {
  const made: any = function written2() {
    throw new Error("x");
  };
  if (name) made[keys[0]] = name;
  made();
});
run(function storesEveryTime(name) {
  const made: any = function written3() {
    throw new Error("x");
  };
  made.displayName = name || undefined;
  made();
});
run(function storesOneOfTwo(name) {
  const made: any = function written4() {
    throw new Error("x");
  };
  if (name === "first") made.displayName = "one";
  else if (name) made.displayName = "two";
  made();
});
run(function deletesByName(name) {
  const made: any = function written5() {
    throw new Error("x");
  };
  if (name) delete made.name;
  made();
});
run(function deletesUnderKey(name) {
  const made: any = function written6() {
    throw new Error("x");
  };
  if (name) delete made[keys[1]];
  made();
});
run(function storesInAnArrow(name) {
  const made: any = () => {
    throw new Error("x");
  };
  if (name) made.displayName = name;
  made();
});
run(function storesBehindTheCall(name) {
  const made: any = function written7() {
    if (name) throw new Error("x");
  };
  try {
    made();
  } finally {
    made.displayName = name;
  }
});
run(function storesBetweenTwoCalls(name) {
  const made: any = function written8(fails: boolean) {
    if (fails) throw new Error("x");
  };
  made(false);
  if (name) made.displayName = name;
  made(true);
});
