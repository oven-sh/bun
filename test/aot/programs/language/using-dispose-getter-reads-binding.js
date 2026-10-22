// The dispose method of a `using` declaration is read before the binding is initialized, as ECMAScript orders it, so a getter for `Symbol.dispose` or `Symbol.asyncDispose` that reads its own binding gets a ReferenceError. Plain Bun initializes the binding first.
function attempt(label, read) {
  try {
    console.log(label, "reads", read().name);
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}

{
  using x = {
    name: "block",
    get [Symbol.dispose]() {
      attempt("block", () => x);
      return () => console.log("block disposed");
    },
  };
  console.log("block body", x.name);
}

function inFunction() {
  using x = {
    name: "function",
    get [Symbol.dispose]() {
      attempt("function", () => x);
      return () => console.log("function disposed");
    },
  };
  return x.name;
}
console.log(inFunction());

{
  using first = { name: "first", [Symbol.dispose]() { console.log("first disposed"); } },
    second = {
      name: "second",
      get [Symbol.dispose]() {
        attempt("second, earlier binding", () => first);
        attempt("second, own binding", () => second);
        attempt("second, later binding", () => third);
        return () => console.log("second disposed");
      },
    },
    third = { name: "third", [Symbol.dispose]() { console.log("third disposed"); } };
  console.log("list body");
}

for (
  using x = {
    name: "loop head",
    get [Symbol.dispose]() {
      attempt("loop head", () => x);
      return () => console.log("loop head disposed");
    },
  };
  ;
) {
  console.log("loop body", x.name);
  break;
}

for (using x of [{ name: "for-of", get [Symbol.dispose]() { attempt("for-of", () => x); return () => console.log("for-of disposed"); } }]) {
  console.log("for-of body", x.name);
}

try {
  using x = {
    name: "getter throws",
    get [Symbol.dispose]() {
      attempt("getter throws", () => x);
      throw new RangeError("no method");
    },
  };
  console.log("never printed");
} catch (error) {
  console.log("caught", error.name);
}

{
  await using x = {
    name: "async",
    get [Symbol.asyncDispose]() {
      attempt("async", () => x);
      return async () => console.log("async disposed");
    },
  };
  console.log("async body", x.name);
}

{
  await using x = {
    name: "async fallback",
    get [Symbol.asyncDispose]() {
      attempt("async fallback, asyncDispose", () => x);
      return undefined;
    },
    get [Symbol.dispose]() {
      attempt("async fallback, dispose", () => x);
      return () => console.log("async fallback disposed");
    },
  };
  console.log("async fallback body", x.name);
}

using top = {
  name: "module",
  get [Symbol.dispose]() {
    attempt("module", () => top);
    return () => console.log("module disposed");
  },
};
console.log("end of module", top.name);
export {};
