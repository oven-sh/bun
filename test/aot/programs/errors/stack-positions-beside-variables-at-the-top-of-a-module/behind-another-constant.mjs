import { fail } from "./fail.mjs";
const holder = { toString: () => String(fail()) };
const atTop = `${holder}`.length;
