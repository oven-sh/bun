// Which code of scrypt's fourth argument runs when it is no function and no fifth follows: it is the callback, and it is described.
import { scrypt } from "node:crypto";
function run() {
  const box = { field: 1 };
  let count = 0;
  const fourth = {
    get constructor() {
      count++;
      box.field = 2;
      return { name: "Named" };
    },
  };
  let message = "no error";
  try {
    scrypt("a", "b", 8, fourth);
  } catch (error) {
    message = error.message;
  }
  console.log("scrypt callback |", message, "|", count, box.field);
}
run();
