import { early, grow, look } from "./first.js";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

attempt("while the first module had not run", () => early);
attempt("afterwards", look);
for (let i = 0; i < 2000; i++) look();
grow();
attempt("after 2000 looks and one more element", look);
