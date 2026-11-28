import { createRequire } from "node:module";
import { show, other } from "./show.mjs";
const own = import.meta.url;
function ask() { return createRequire(import.meta.url)("./beside-twice.cjs").name; }
show("twice own", ask);
import.meta.url = other;
import.meta.url = own;
show("twice own again", ask);
