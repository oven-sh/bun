import { round } from "./wide.mjs";
export const look = () => (typeof round === "object" ? "a namespace" : String(round));
