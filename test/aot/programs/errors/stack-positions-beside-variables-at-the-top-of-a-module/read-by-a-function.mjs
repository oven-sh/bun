import { fail } from "./fail.mjs";
const atTop = `${{ toString: () => String(fail()) }}`.length;
export function reads() {
  return atTop;
}
