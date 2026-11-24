import { x } from "./dep.mjs";
import "./broken.mjs";
export const seen = () => x;
