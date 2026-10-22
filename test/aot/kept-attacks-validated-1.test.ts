// The attack programs once more in a validating build: there the executable itself checks, while it runs, what the compiler took for proven, and stops at the first proof that is false.
// A false proof need not show in what this program prints: it shows in the next one.
import { programsBuiltWith } from "./run-programs";

programsBuiltWith("kept-attacks", "validated", ["--aot-validate"], {}, 1, 4);
