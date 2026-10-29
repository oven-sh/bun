// scrypt with an undefined fifth argument takes the fourth as the callback and reads no option of it.
import { scrypt } from "node:crypto";
function run() {
  const box = { field: 1 };
  let count = 0;
  const options = {
    get N() {
      count++;
      box.field = 2;
      return 2;
    },
    get cost() {
      count++;
      box.field = 3;
      return "x";
    },
  };
  let message = "no error";
  try {
    scrypt("a", "b", 8, options, undefined);
  } catch (error) {
    message = error.code + " " + error.message;
  }
  console.log("scrypt fifth undefined |", message, "|", count, box.field);
}
run();
