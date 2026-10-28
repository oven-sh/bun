export * from "./makers.js";
export { default as Default } from "./makers.js";
import { Counted, Base } from "./makers.js";
export const FromAgain = Counted(Base);
