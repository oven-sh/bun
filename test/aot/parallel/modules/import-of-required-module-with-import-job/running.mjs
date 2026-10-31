import { value } from "./imported.mjs";
require("./imports-back.mjs");
turns("running");
export const ended = value === 1;
