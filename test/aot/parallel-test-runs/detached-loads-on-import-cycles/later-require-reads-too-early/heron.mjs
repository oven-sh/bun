import { label as pond } from "./pond.mjs";
globalThis.bodies.push("heron");
export const label = "heron" + " over " + pond;
export const below = () => [pond].join();
