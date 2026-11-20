import { counter } from "./helpers.mjs";
import { step } from "./helpers.mjs";

export default (counter, `${{ toString: () => String(step(2)) }}`);
