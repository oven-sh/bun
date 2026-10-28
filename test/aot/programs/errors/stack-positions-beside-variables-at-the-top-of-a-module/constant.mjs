import { fail } from "./fail.mjs";
const atTop = `${{ toString: () => String(fail()) }}`.length;
