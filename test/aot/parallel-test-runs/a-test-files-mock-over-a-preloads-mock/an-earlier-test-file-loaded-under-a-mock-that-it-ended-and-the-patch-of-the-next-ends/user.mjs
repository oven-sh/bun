import * as all from "./barrel.mjs";
import * as own from "made-up-pack/w.mjs";
import { kept } from "made-up-pack/w.mjs";
const read = (object, name) => object[name];
export const look = () => [read(all, "kept"), read(own, "kept"), kept].join(" ");
