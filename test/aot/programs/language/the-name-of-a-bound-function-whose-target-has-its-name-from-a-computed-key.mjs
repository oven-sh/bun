// Prints the name of what bind() makes of a function that has its name from a computed key.
const key = process.argv.length > 1000 ? "other" : "plain";
const symbol = Symbol("described");
const show = (form, f) =>
  console.log(
    form,
    "|",
    JSON.stringify(f.name),
    "|",
    JSON.stringify(f.bind(null).name),
    "|",
    JSON.stringify(f.bind(null).bind(null).name),
  );
show("a method", { [key]() {} }[key]);
show("a method under a symbol", { [symbol]() {} }[symbol]);
show("a function expression", { [key]: function () {} }[key]);
show("an arrow function", { [key]: () => {} }[key]);
show(
  "a method of a class",
  new (class {
    [key]() {}
  })()[key],
);
show(
  "a static method",
  class {
    static [key]() {}
  }[key],
);
show(
  "a getter",
  Object.getOwnPropertyDescriptor(
    {
      get [key]() {
        return 1;
      },
    },
    key,
  ).get,
);
show("an async method", { async [key]() {} }[key]);
show("a generator method", { *[key]() {} }[key]);
show("a method under a written key", { plain() {} }.plain);
const withProperty = { [key]() {} }[key];
withProperty.added = 1;
show("a method that has got a property", withProperty);
