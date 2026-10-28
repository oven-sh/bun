import { fail } from "./fail.mjs";
let atTop = `${{ toString: () => String(fail()) }}`.length;
