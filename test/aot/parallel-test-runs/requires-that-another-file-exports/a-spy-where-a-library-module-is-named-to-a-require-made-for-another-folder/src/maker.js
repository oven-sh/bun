import { createRequire } from "node:module";
export const load = createRequire(process.cwd() + "/");
export const askOwn = () => load("node:path").sep;
