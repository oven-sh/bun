// Group 00: the examples that parser.md names, as a smoke test of the runner.
import { list } from "./_lib.mjs";
export const families = { smoke: { bun: "", ref: "" } };
export default {
  name: "smoke",
  families,
  emit: true,
  cases: list("smoke", [
    "let x: (a: ) => void",
    "let f = (a): => a",
    "f<A | >(x)",
    "const v = <out>x",
    "let g: (a = 1) => void",
    "type as = 1",
    "interface as {}",
    "type T = { foo(1): void }",
    "let x: A | B extends C ? D : E",
  ]),
};
