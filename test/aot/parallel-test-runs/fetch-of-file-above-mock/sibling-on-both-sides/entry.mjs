import "./first.mjs";
import { own, get } from "./barrel.mjs";
import "./sibling.mjs";
export const entry = () => own() + " " + typeof get;
