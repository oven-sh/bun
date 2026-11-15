import "./barrel.mjs";
import { late } from "./one.mjs";
import { more } from "./more.mjs";
export const ask = () => late() + more();
