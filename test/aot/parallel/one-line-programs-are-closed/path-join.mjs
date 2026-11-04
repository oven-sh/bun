// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can see every API this program uses
import { join } from "node:path"; console.log(join("a", "b"));
