// The control: the use can run, so the file runs.
import { mark } from "./quiet-box/loud.mjs";
function used() {
  function called() { return mark(); }
  return "main ran " + called();
}
console.log(used());
