import { createRequire } from "node:module";
import "./beside.cjs";
import "../other/beside.cjs";
const own = new URL(import.meta.url);
export const kept = createRequire(own);
