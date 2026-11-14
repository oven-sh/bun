import { seen as s } from "./user.mjs";
console.log("app runs", s());
export const seen = () => "app " + s();
