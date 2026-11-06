// A TypeError at the top level of a file quotes what failed as it is written, whatever kind of file it is: with types, required, required with its five names in use, imported, or waiting.
import { tell } from "./tell.ts";
import "./typed.ts";
import "./awaits.mjs";
import { createRequire } from "node:module";

interface Holder {
  none: null | { x: number };
}
type Key = "x";
const holder: Holder = { none: null };
try { console.log((holder as Holder).none!.x); } catch (error) { tell("main", error); }
const require = createRequire(import.meta.url);
require("./required.cjs");
require("./wrapped.cjs");
try { require("./throws.cjs"); } catch (error) { tell("thrown by a required file", error); }
try { await import("./throws.mjs"); } catch (error) { tell("thrown by an imported file", error); }
