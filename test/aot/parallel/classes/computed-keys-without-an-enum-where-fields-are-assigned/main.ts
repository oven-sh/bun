// Keys in brackets without an enum, where the tsconfig.json beside the classes says that fields are assigned: what the transpiler of `bun build` has as a string or a number in the brackets is no key that it has to compute.
// Reference: bun build --compile
import "./keys/classes.ts";
