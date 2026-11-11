import { slow, number } from "./slow.js";
globalThis.users = (globalThis.users ?? 0) + 1;
export const seen = () => slow + " user " + globalThis.users;
