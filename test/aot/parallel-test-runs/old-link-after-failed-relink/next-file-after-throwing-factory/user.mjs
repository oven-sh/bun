import * as all from "./last.mjs";
import { square, flat } from "./last.mjs";
export const member = () => [[square, all.square, all[JSON.parse('"square"')]].join("/"), [flat, all.flat, all[JSON.parse('"flat"')]].join("/")].join(" ");
