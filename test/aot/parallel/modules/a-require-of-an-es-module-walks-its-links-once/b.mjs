import pack from "./pack.cjs";
import { join } from "node:path";
import { shared } from "./shared.mjs";
globalThis.ran.push("b");
export const name = pack.twice(join("b", shared));
