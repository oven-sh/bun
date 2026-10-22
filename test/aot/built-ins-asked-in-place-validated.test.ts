// The same programs in a validating build: a fact that the compiler used about what a built-in answers is tested where it is used, and a wrong one ends the program.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("built-ins-asked-in-place", "validated", ["--aot-validate"]);
