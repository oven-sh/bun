import { counter, step, thing, wrapped } from "./helpers.mjs";
counter.total = wrapped(1);

export default (0, `${{ toString: () => String(step(2)) }}`);
