import { add, name } from "./util.mjs";
export const use = () => String(add(1, 2)) + " " + String(name());
