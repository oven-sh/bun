import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);
export const askMember = () => load("./value.js").name;
