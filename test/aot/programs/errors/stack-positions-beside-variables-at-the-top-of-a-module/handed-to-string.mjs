import { fail } from "./fail.mjs";
const atTop = String({ toString: () => String(fail()) });
