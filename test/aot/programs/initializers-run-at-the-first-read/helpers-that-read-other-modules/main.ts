// Helpers called at the top level read variables of their own modules, which may not have run to their end.
import { shape, counted, withDefaults, inMode, setMode, registry, DEFAULTS, Shape } from "./kit";
import { A_USES_B } from "./circle-a";
import { B_USES_A } from "./circle-b";
import { SEEN, EARLY } from "./requires-back";
import { PLAIN } from "./required-back";
const log: string[] = [];
const TREE = shape("root", shape("leaf"), shape("leaf"));
const COUNTED = counted("c");
log.push("registry " + registry.join());
const DEFAULTED = withDefaults("d");
DEFAULTS.depth = 7;
const MODE = inMode("m");
setMode("second");
function early() { return helperBelow(); }
let EARLY_CALL: unknown; try { EARLY_CALL = early(); } catch (error) { EARLY_CALL = (error as Error).name; }
const BELOW = { v: 1 };
function helperBelow() { return { below: BELOW.v }; }
const AFTER = helperBelow();
log.push(JSON.stringify([TREE, TREE instanceof Shape, COUNTED, DEFAULTED, MODE, EARLY_CALL, AFTER]));
log.push(JSON.stringify([A_USES_B, B_USES_A, SEEN, EARLY, PLAIN]));
console.log(log.join("\n"));
