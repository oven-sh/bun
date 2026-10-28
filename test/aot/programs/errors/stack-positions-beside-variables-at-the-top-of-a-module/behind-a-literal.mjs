import { fail } from "./fail.mjs";
const holder = { toString: () => String(fail()) };
const atTop = `a${1}${holder}`;
