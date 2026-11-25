import { user } from "./user";
console.log("other runs");
export const other = () => "other " + user();
