import { list as firstList } from "./first.js";
export const name = "fourth";
export const list = firstList.map(item => typeof item);
export default { kind: "default of the fourth" };
