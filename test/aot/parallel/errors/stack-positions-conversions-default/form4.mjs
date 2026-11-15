import { counter, step, thing, wrapped } from "./helpers.mjs";
counter.total = wrapped(1);

export default `${{
  first: 1,
  second: 2,
  third: 3,
  toString() {
    return String(step(2));
  },
}}`;
