import { read } from "./user.mjs";
import * as bad from "./bad.mjs";
globalThis.ran = (globalThis.ran ?? "") + "t";
export const top = () => read() + bad.bad();
