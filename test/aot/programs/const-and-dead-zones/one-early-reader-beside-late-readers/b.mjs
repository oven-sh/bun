import { attempt } from "./results.mjs";
import { value, readValue, readOnce, counter, bump } from "./a.mjs";
attempt("b, the binding", () => value);
attempt("b, readValue", readValue);
attempt("b, readOnce", readOnce);
attempt("b, counter", () => counter);
attempt("b, bump", bump);
export const fromB = "from b";
