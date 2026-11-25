globalThis.runs = (globalThis.runs ?? 0) + 1;
import { sep, d, all } from "./barrel.mjs";
import * as whole from "./barrel.mjs";
export const view = () => [d.sep, sep, all.sep, whole.sep, whole.all.sep].join();
