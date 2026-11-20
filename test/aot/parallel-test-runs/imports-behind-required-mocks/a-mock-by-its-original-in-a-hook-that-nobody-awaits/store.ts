import { row } from "./database.ts";
console.log("the store runs");
export const get = () => "real " + row();
export const put = () => "put";
