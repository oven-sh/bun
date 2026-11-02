import { MODE } from "./stores.cjs";
if (MODE === "development") require("./unused-by-text");
export const mode = MODE;
