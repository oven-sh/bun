// A stack frame shows the name that its function object has when the stack is read. Which function objects may get another name is a result of flow, and it hangs on the result that says
// what may happen to an object. A build without that one takes every function object for one that may be renamed, and prints what `bun run` prints.
import { programsBuiltWith } from "./run-programs";

const flags = ["--aot-disable=flow:HolderMutations"];

programsBuiltWith("errors", "without-the-mutations-of-holders", flags, {}, 1, 1, [
  "stack-frames-name-each-function-object-of-a-factory",
  "stack-frames-name-each-function-object-of-a-factory-at-every-depth-of-long-chains-of-calls",
  "stack-frames-of-functions-given-a-display-name-where-nobody-sees-it-however-they-are-called",
  "stack-frames-of-new-function-objects-whose-names-were-read-before-the-objects-changed",
  "stack-frames-of-renamed-async-functions-and-generators",
  "stack-frames-of-renamed-classes-and-functions-that-hold-values-across-the-call-that-throws",
]);
programsBuiltWith("collector", "without-the-mutations-of-holders", flags, {}, 1, 1, [
  "function-objects-named-while-the-program-runs-outlive-the-collections-inside-their-calls",
]);
