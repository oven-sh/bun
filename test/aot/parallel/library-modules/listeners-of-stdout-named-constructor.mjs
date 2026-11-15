// The Function constructor comes out of code of the library under the name `constructor`, and runs the text, as in `bun <file>`: as a listener of process.stdout.
const found = process.stdout.listeners("constructor")[0];
try {
  console.log(
    found
      ? Reflect.get(found, "getOwnPropertyDescriptor")(
          Reflect.getPrototypeOf(function () {}),
          "constructor",
        ).value("return 6 * 7")()
      : "nothing is inherited",
  );
} catch (error) {
  console.log(error.name);
}

