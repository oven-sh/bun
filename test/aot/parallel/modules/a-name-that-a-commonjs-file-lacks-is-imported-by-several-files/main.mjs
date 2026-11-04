// The check of a graph throws for the first file that imports a name which the CommonJS file lacks. It is written once for the name, however many files import it.
import { a } from "./a.mjs";
import { b } from "./b.mjs";
console.log(a, b);
try { await import("./late.mjs"); } catch (e) { console.log("late:", e.name, e.message.replace(/'[^']*lib\.cjs'/, "'lib.cjs'")); }
