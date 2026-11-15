import { rate } from "./shop.mjs";
import * as shop from "./shop.mjs";
const say = read => { try { return String(read()); } catch (e) { return e.name; } };
export const line = key => [say(() => rate), say(() => shop.rate), say(() => shop[key]), say(() => { const { rate: got } = shop; return got; }), say(() => Object.keys(shop).join("+")), say(() => key in shop), say(() => Reflect.get(shop, key))].join(" | ");
