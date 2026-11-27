import { base } from "./base.mjs";
export let mark = "mark " + base;
export const bump = () => { mark += "!"; };
