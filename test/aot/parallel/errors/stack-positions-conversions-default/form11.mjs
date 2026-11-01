import { counter, step, thing, wrapped } from "./helpers.mjs";
counter.total = wrapped(1);

export default `${wrapped(thing)}`;
