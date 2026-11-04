import { flag, fn } from "./barrel.js";
import * as all from "./barrel.js";

export const read = () => fn() + "," + flag;
export const readOffObject = () => all.fn() + "," + all.flag;
