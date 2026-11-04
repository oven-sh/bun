import { test } from "bun:test";
import { plain, steps, storedOn } from "./app.js";

// No file names the object that stands above every generator function.
test("a name is stored on the object above a generator function", () => {
  console.log("as made:", storedOn(steps), storedOn(plain));
  Object.getPrototypeOf(function* () {}).stored = 1;
  console.log("stored:", storedOn(steps), storedOn(plain), "stored" in steps, Object.hasOwn(steps, "stored"));
  delete Object.getPrototypeOf(steps).stored;
  console.log("taken away:", storedOn(steps), storedOn(plain));
});
