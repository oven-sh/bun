import { Readable } from "node:stream";
let found;
const stream = new Readable();
stream.on("removeListener", (type, listener) => {
  found = listener;
});
stream.removeAllListeners("constructor");
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
