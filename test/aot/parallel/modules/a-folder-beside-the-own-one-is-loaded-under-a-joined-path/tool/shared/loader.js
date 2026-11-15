import path from "node:path";
export const load = name => import(path.join(import.meta.dir, "../plugins", name + ".js"));
