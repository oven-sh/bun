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

/* Output:
EvalError
*/
