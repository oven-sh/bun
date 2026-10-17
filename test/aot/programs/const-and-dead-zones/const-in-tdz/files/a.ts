import { early, viaNamespace } from "./b";
export const number = 37, text = "text", flag = true, nothing = null, sum = 1 + 2;
export function readLater(): string { return [number, text, flag, nothing, sum].join(); }
export const seen: string = early + " | " + viaNamespace;
