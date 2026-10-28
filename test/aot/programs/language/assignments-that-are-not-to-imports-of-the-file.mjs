// Assignments that a build accepts: to names that hide an import, or written in text made at run time.
import { sep } from "node:path";
const say = (name, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  console.log(name + ": " + String(answer));
};
say("a parameter of the same spelling", () => (sep => (sep = 1))(0));
say("a name of the same spelling in a block", () => {
  let sep = 2;
  sep++;
  return sep;
});
say("evaluated text names the import", () => eval("sep = 4"));
say("evaluated text increments the import", () => eval("sep++"));
say("the import is as it was", () => sep);
