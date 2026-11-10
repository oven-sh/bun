import { region } from "./settings.mjs";
globalThis.storeRan = (globalThis.storeRan ?? 0) + 1;
export const list = () => "list " + region;
