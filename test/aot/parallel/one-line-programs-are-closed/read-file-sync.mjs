// Flags: --explain=trim
// Build prints: 1 x aot: trim: the compiler can see every API this program uses
import { readFileSync } from "node:fs"; console.log(typeof readFileSync);
