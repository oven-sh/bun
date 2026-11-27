// docs/compiler/compatibility.mdx, "sideEffects": a use counts where the code that holds it can run. `bun run` does not read the field, and `bun build` counts a use in any function of a statement that stays.
import "./program.mjs";
/* Output:
main ran
*/
