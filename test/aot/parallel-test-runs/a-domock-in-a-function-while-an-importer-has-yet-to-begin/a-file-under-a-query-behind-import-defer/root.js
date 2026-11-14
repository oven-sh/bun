import defer * as later from "./later.js";
import { mockModule } from "./wrap.js";
let count = 0;
mockModule(import.meta.dir + "/dep.js?v", () => {
  count++;
  return { who: () => "mock" };
});
export const atCall = count;
export const via = () => later.read();
