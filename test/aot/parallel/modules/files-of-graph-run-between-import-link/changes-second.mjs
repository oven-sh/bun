import { value } from "./changes-file.cjs";
import { value as other } from "./changes-other.cjs";
globalThis.log.push("changes-second");
export const total = value + other;
