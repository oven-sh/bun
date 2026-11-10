import { rate } from "./shop.mjs";
import * as shop from "./shop.mjs";
export const byStatement = () => rate;
export const offNamespace = () => shop.rate;
export const byKey = key => shop[key];
