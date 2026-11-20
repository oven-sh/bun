// scrypt refuses both names of an option when it reads the second, before it reads a later one and before it looks at the callback.
import { scrypt } from "node:crypto";
function run() {
  const read = [];
  const options = {
    get N() {
      read.push("N");
      return 2;
    },
    get cost() {
      read.push("cost");
      return "x";
    },
    get r() {
      read.push("r");
      return 1;
    },
  };
  let message = "no error";
  try {
    scrypt("a", "b", 8, options, 5);
  } catch (error) {
    message = error.code + " " + error.message;
  }
  console.log("scrypt pair |", message, "|", read.join());
}
run();
