import { callbackify } from "node:util";
async function work(first) {
  return { doubled: first * 2 };
}
callbackify(work)(1.5, (error, value) => console.log(error === null, value.doubled + 1));
