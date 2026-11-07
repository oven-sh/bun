// docs/compiler/compatibility.mdx, "sideEffects": a use counts where the code that holds it can run. `bun run` does not read the field, and `bun build` counts a use in any function of a statement that stays.
import { mark } from "./quiet-box/loud.mjs";
function used() {
  const neverCalled = () => mark();
  return "main ran";
}
console.log(used());
/* Output:
main ran
*/
