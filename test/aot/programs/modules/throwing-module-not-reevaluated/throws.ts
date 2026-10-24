import { seen } from "./seen";
seen.push("throws");
throw new Error("thrown by throws.ts");
