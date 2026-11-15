import { createRequire } from "node:module";
import "./beside.cjs";
const elsewhere = new URL(import.meta.url);
if (process.argv.length < 9) elsewhere.pathname = elsewhere.pathname.replace("lib/mover.mjs", "other/start.cjs");
export const moved = createRequire(elsewhere);
