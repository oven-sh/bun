import { label as reed } from "./reed.mjs";
import { label as pond } from "./pond.mjs";
globalThis.bodies.push("heron");
export const label = "heron" + " over " + reed;
export const below = () => [reed, pond].join();
