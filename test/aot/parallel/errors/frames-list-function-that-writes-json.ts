// Prints the names in stack traces taken in toJSON methods and getters while JSON.stringify and Response.json write objects of declared classes.
const names = (error: Error): string =>
  String(error.stack)
    .split("\n")
    .slice(1)
    .map(line => line.replace(/^\s*at /, "").replace(/[@ (].*$/, ""))
    .map(name => (/[\\/]/.test(name) ? "module" : name))
    .join(" < ");
let seen: string[] = [];
function note(): number {
  if (seen.length < 1) seen.push(names(new Error("here")));
  return 0;
}
function show(label: string, run: () => unknown): void {
  for (let round = 0; round < 2; round++) {
    seen = [];
    run();
    console.log(label + ": " + seen.join(" | "));
  }
}
function outer(run: () => unknown): unknown {
  return run();
}
class Leaves {
  toJSON(): number {
    return note();
  }
}
class Stays {
  toJSON(): number[] {
    const result = note();
    return [result];
  }
}
class Holder {
  first = 1;
  inner = new Stays();
}
class Nested {
  holder = new Holder();
  list = [new Holder()];
}
class Computes {
  first = 1;
  get second(): number[] {
    const result = note();
    return [result];
  }
}
interface Read {
  first: number;
  second: number[];
}
const read: Read = {
  first: 1,
  get second(): number[] {
    const result = note();
    return [result];
  },
};

show("an array, the method leaves", () => outer(() => JSON.stringify([new Leaves()])));
show("an array, the method stays", () => outer(() => JSON.stringify([new Stays()])));
show("an object alone", () => outer(() => JSON.stringify(new Stays())));
show("a field", () => outer(() => JSON.stringify(new Holder())));
show("a field of a field", () => outer(() => JSON.stringify(new Nested())));
show("a literal", () => outer(() => JSON.stringify({ first: 1, inner: new Stays() })));
show("a getter of the class", () => outer(() => JSON.stringify(new Computes())));
show("a getter of a literal", () => outer(() => JSON.stringify(read)));
show("the text is used", () => {
  const text = JSON.stringify([new Stays()]);
  return text + ".";
});
show("a field, the text is used", () => {
  const text = JSON.stringify(new Nested());
  return text + ".";
});
show("in a loop", () => {
  let length = 0;
  for (let index = 0; index < 3; index++) length += JSON.stringify(new Holder()).length;
  return length;
});
show("a response", () => outer(() => Response.json(new Holder())));
show("a response, an array", () => outer(() => Response.json([new Stays()])));
show("a response that is used", () => {
  const response = Response.json(new Nested());
  return response.status;
});
