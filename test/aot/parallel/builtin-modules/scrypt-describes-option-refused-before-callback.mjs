// Which code of a refused member of scrypt's options runs when a callback follows: the callee is known, and the values are local.
import { scrypt } from "node:crypto";
function run() {
  const box = { field: 1 };
  let count = 0;
  const member = {
    get constructor() {
      count++;
      box.field = 2;
      return { name: "Named" };
    },
  };
  let message = "no error";
  try {
    scrypt("a", "b", 8, { N: member }, () => {});
  } catch (error) {
    message = error.message;
  }
  console.log("scrypt option |", message, "|", count, box.field);
}
run();
