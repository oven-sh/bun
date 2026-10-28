import { fail } from "./fail.mjs";
export const atTop = `${{ toString: () => String(fail()) }}`.length;
