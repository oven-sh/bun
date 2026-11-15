import "./sibling.mjs";
import { own, get } from "./barrel.mjs";
import "./second.mjs";
export const entry = () => own() + " " + typeof get;
