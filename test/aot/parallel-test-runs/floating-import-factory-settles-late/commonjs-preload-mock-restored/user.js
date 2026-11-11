import * as it from "./part.cjs";
export const x = "user sees " + (it.x ?? it.default?.x);
