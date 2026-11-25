import "./sibling.mjs";
import { own, get } from "./barrel.mjs";
export const entry = () => own() + " " + typeof get;
