import pack from "./pack.cjs";
import { join } from "node:path";
import { shared } from "./shared.mjs";
globalThis.ran.push("a");
export const name = pack.twice(join("a", shared));
