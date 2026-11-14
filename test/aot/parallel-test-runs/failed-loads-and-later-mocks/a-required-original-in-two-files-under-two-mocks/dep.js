globalThis.ran = (globalThis.ran ?? '') + 'd';
import { inner } from "./inner.js";
export const flag = "real " + inner;
