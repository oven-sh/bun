// The accesses of elements-outside-hot-code in code that the compiler takes for cold: there nothing of an access stands in line, and the stubs answer for elements that are there too
// Flags: --aot-heat=EverythingIsCold
import { run } from "../elements-outside-hot-code/accesses.js";

console.log(run().join("\n"));
