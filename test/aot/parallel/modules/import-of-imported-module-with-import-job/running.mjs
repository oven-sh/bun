import { value } from "./imported.mjs";
require("./imports-back.mjs");
turns("running", 10);
export const ended = value === 1;
