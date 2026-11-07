// The Function constructor comes out of code of the library under the name `constructor`, and runs the text, as in `bun <file>`: as what a listener for `removeListener` hears.
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

