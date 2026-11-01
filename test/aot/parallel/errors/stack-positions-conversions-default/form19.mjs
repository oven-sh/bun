import { counter, step, thing, wrapped } from "./helpers.mjs";
counter.total = wrapped(1);

export default [1, 2, `${{ toString: () => String(step(2)) }}`];
