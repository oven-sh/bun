import * as all from "./shapes.mjs";
export const seen = () => Reflect.ownKeys(all).map(String).join() + " " + String(all.sides);
