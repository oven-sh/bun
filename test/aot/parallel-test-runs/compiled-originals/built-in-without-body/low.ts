import { format, inspect as show } from "node:util";
import { text } from "node:stream/consumers";
export { isDeepStrictEqual } from "node:util";
export function read() {
  return format("%s", "low") + show({ a: 1 }) + typeof text;
}
