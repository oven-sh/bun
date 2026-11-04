// Keys in brackets that rest on a member of an enum, each as a field, a static field, a method, a getter, an accessor, a key of a literal and of a pattern. The tsconfig.json beside the classes says that fields are assigned:
// `bun build` assigns them unless a field stands under a key that it has to compute. A member that it has written in place is such a key, also where an operator or a constant puts it there. What is computed with a member, or chosen by one, is not.
// Reference: bun build --compile
import "./keys/classes.ts";
