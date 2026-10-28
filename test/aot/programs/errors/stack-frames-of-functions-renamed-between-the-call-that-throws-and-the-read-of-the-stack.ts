// A function makes a function object, calls it, catches what it throws, and only then gives the function object a displayName or another name, or hands it to a function that does. The stack is read later still. Each function object is made several times: some are renamed, some are left alone. Prints what the frames call each of them.
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
const names = ["", "second", "", "fourth"];
function storesDisplayName(): unknown[] {
  const caught: unknown[] = [];
  for (const name of names) {
    const made: any = function written1() {
      throw new Error("x");
    };
    try {
      made();
    } catch (error) {
      caught.push(error);
    }
    if (name) made.displayName = name;
  }
  return caught;
}
function definesName(): unknown[] {
  const caught: unknown[] = [];
  for (const name of names) {
    const made = function written2() {
      throw new Error("x");
    };
    try {
      made();
    } catch (error) {
      caught.push(error);
    }
    if (name) Object.defineProperty(made, "name", { value: name });
  }
  return caught;
}
function handsOn(): unknown[] {
  const caught: unknown[] = [];
  for (const name of names) {
    const made = function written3() {
      throw new Error("x");
    };
    try {
      made();
    } catch (error) {
      caught.push(error);
    }
    rename(made, name);
  }
  return caught;
}
function storesInTheHandler(): unknown[] {
  const caught: unknown[] = [];
  for (const name of names) {
    const made: any = () => {
      throw new Error("x");
    };
    try {
      made();
    } catch (error) {
      if (name) made.displayName = name;
      caught.push(error);
    }
  }
  return caught;
}
function storesOnTheWayOut(name: string): void {
  const made: any = function written4() {
    throw new Error("x");
  };
  try {
    made();
  } finally {
    if (name) made.displayName = name;
  }
}
function returnsIt(caught: unknown[]): Function {
  const made = function written5() {
    throw new Error("x");
  };
  try {
    made();
  } catch (error) {
    caught.push(error);
  }
  return made;
}
for (const list of [storesDisplayName(), definesName(), handsOn(), storesInTheHandler()])
  console.log(list.map(frames).join(", "));
for (const name of names) {
  try {
    storesOnTheWayOut(name);
  } catch (error) {
    console.log(frames(error));
  }
}
const caught: unknown[] = [];
for (const name of names) rename(returnsIt(caught), name);
console.log(caught.map(frames).join(", "));
