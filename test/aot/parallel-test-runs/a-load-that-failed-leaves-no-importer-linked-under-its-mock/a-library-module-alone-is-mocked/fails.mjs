import { look } from "./user.mjs";
globalThis.seen = typeof look() === "function" ? "real" : look();
throw new Error("the body throws");
