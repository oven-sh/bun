import { label as fern } from "./fern.mjs";
import { label as heron } from "./heron.mjs";
globalThis.bodies.push("pond");
export const label = "pond";
export const below = () => [fern, heron].join();
