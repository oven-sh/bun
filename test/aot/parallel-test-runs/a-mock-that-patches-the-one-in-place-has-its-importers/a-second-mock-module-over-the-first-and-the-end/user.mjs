import * as all from "./barrel.mjs";
import * as own from "pack/w.mjs";
import { kept, side } from "pack/w.mjs";
const read = (object, name) => object[name];
export const look = () => [read(all, "kept"), read(all, "side"), read(own, "kept"), read(own, "side"), kept, side].join(" ");
