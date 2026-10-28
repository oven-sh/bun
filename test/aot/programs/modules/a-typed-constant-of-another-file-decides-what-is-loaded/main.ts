// The same in TypeScript: annotated, asserted and merged with a type of the same name.
import limit, { debug, Mode, port, name, cast, type Shape } from "./flags";
import * as flags from "./flags";
import { twice } from "./computed";
const shape: Shape = { port };
const mode: Mode = Mode;
if (debug) await import("./never");
if (flags.debug) await import("./never");
if (port !== 80) await import("./never");
if (twice !== 160) await import("./never");
if ((cast as unknown as number) !== 7) await import("./never");
console.log(shape, mode, name, limit, twice, flags.name.length);
