import { id, query } from "./pool.cjs";
export const find = () => String(query("users")) + " " + id;
