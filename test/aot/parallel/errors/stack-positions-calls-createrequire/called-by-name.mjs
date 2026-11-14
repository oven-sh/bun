import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const load = () => require("./throws-2.cjs");
export const loaded = load();
