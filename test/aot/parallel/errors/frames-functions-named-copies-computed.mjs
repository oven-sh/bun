// Function objects of one function get a `displayName` or a `name` each: by a copy, by a store or by a definition under a key that is put together while the program runs. A stack frame shows the
// name of the function object that was called. The program also holds an import() whose path comes from the environment, which it never reaches.
if (process.env.NAME_OF_A_MODULE_TO_LOAD) await import(process.env.NAME_OF_A_MODULE_TO_LOAD);
const top = stack =>
  stack
    .split("\n")
    .slice(1, 2)
    .map(line => line.trim().replace(/ \(.*$/, ""))
    .join();
const key = ["display", "Name"].join("");
const ways = {
  "a store under a computed key": name => {
    const f = function () {
      return new Error("x").stack;
    };
    f[key] = name;
    return f;
  },
  "a definition under a computed key": name =>
    Object.defineProperty(
      function () {
        return new Error("x").stack;
      },
      key,
      { value: name },
    ),
  "Object.assign": name =>
    Object.assign(
      function () {
        return new Error("x").stack;
      },
      { displayName: name },
    ),
  "Object.assign of a computed key": name =>
    Object.assign(
      function () {
        return new Error("x").stack;
      },
      { [key]: name },
    ),
  "Object.defineProperties": name =>
    Object.defineProperties(
      function () {
        return new Error("x").stack;
      },
      { displayName: { value: name } },
    ),
  "Object.defineProperties of name": name =>
    Object.defineProperties(
      function () {
        return new Error("x").stack;
      },
      { name: { value: name } },
    ),
  "Reflect.set": name => {
    const f = function () {
      return new Error("x").stack;
    };
    Reflect.set(f, key, name);
    return f;
  },
  "descriptors copied one by one": name => {
    const f = function () {
      return new Error("x").stack;
    };
    const from = { displayName: name };
    for (const each of Reflect.ownKeys(from)) Object.defineProperty(f, each, Object.getOwnPropertyDescriptor(from, each));
    return f;
  },
};
for (const [way, make] of Object.entries(ways)) {
  const [first, second] = [make("first"), make("second")];
  console.log(way + ":", top(first()), "/", top(second()), "/", top(first()));
}
