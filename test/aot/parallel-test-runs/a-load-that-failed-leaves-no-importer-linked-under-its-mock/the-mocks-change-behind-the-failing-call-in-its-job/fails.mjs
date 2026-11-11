(globalThis.bodies ??= []).push("fails");
import { look } from "./user.mjs";
globalThis.seen = look();
throw new Error("the body throws");
