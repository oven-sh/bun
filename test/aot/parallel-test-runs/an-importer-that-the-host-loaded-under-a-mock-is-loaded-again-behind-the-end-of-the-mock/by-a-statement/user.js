globalThis.runs ??= {}; globalThis.runs.user = (globalThis.runs.user ?? 0) + 1;
import { x } from "./part.cjs";
export const seen = () => x;
