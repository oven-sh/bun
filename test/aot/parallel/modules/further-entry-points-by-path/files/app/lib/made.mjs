import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
export const load = name => made(name);
export const imports = name => import(name);
