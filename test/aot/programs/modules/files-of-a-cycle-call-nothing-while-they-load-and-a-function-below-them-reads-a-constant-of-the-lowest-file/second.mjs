import { viaThird } from "./first.mjs";
export function other() {
  return typeof viaThird === "function" ? 1 : 0;
}
