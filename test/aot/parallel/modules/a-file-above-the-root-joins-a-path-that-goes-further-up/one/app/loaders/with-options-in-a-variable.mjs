import path from "node:path";
const options = { with: { type: "json" } };
export const load = name => import(path.join(import.meta.dirname, "../../texts", name + ".json"), options);
