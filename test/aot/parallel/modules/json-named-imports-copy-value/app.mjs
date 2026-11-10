import "./early.cjs";
import data, { inner } from "./list.json";
export const here = 1;
console.log("app", JSON.stringify(data), JSON.stringify(inner), data.inner === inner);
