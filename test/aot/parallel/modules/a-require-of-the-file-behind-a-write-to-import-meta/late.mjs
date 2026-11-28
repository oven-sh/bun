import { createRequire } from "node:module";
import { show, other } from "./show.mjs";
const before = createRequire(import.meta.url);
show("late before", () => before("./beside-late.cjs").name);
import.meta.url = other;
show("late after, made before", () => before("./beside-late.cjs").name);
