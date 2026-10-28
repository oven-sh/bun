import { fail } from "./fail.mjs";
var atTop = `${{ toString: () => String(fail()) }}`.length;
