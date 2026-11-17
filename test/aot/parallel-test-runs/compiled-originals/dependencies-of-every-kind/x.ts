import { g } from "./y";
import data from "./d.json";
import c from "./c.cjs";
import { basename } from "node:path";
import p, { q } from "pack";
console.log("SAID body", data.v, c.w, basename("/a/b"), p.name, q);
export const f = () => [g(), data.v, c.w++, c.tick(), q].join();
