import * as marked from "./under-the-mark.js";
import * as plain from "./without-the-mark.js";
test("names", () => {
  console.log(marked.seen());
  console.log(plain.seen());
});
