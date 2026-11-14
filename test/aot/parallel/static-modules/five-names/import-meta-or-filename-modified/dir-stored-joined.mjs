import path from "node:path";
import.meta.dir = import.meta.dir + "/other";
export default (await import(path.join(import.meta.dir, "a.js"))).default;
