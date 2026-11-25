import { word } from "./word.ts";
globalThis.runtimes = (globalThis.runtimes ?? 0) + 1;
const own = globalThis.runtimes;
export const Panel = Object.assign(() => 1, { toString: () => word + own });
