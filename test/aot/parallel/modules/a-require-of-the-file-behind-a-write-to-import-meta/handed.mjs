import { createRequire } from "node:module";
import { show, other, write } from "./show.mjs";
show("handed before", () => createRequire(import.meta.url)("./beside-handed.cjs").name);
write(import.meta, other);
