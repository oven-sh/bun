import { label as moss } from "./moss.mjs";
import { label as pond } from "./pond.mjs";
globalThis.bodies.push("bank");
export const label = "bank";
export const below = () => [moss, pond].join();
