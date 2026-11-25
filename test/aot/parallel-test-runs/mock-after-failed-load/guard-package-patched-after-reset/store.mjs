import { region } from "@failed-graph-made-up/settings";
globalThis.storeRan = (globalThis.storeRan ?? 0) + 1;
export const list = () => "list " + region;
