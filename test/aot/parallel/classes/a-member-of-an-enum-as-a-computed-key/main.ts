// To Bun's transpiler a member of an enum that it has written in place is no number and no string: `[Numbers.one]` stays a key that is computed, also where `?:`, `||`, `&&`, `??` or a constant
// puts the member there, and a class with a field under such a key keeps its fields though its tsconfig.json says that fields are assigned. `-Numbers.one` and `Numbers.one + 1` are numbers.
// Reference: bun build --compile
import { run as runAssigned } from "./assigned/classes.ts";
import { run as runDefined } from "./defined/classes.ts";
runAssigned("assigned");
runDefined("defined");
