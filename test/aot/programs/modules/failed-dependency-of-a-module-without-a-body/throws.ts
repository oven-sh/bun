import { seen } from "./seen";
seen.push("throws");
export const value = seen.length;
throw new Error("thrown by throws.ts");
