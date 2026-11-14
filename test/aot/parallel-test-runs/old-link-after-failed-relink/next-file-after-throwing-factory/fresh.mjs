import * as all from "./last.mjs";
import { flat } from "./last.mjs";
export const member = () => [[flat, all.flat, all[JSON.parse('"flat"')]].join("/")].join(" ");
