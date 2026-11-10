import * as all from "./barrel.mjs";
import * as own from "made-up-pack/w.mjs";
const read = (object, name) => (name in object ? String(object[name]) : "absent");
export const look = () => [read(all, "kept"), read(own, "kept"), read(all, "spare"), read(own, "spare")].join(" ");
