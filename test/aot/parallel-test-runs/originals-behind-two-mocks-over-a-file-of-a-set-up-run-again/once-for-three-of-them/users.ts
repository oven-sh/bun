import { query } from "./pool.cjs";
export const find = () => query("users");
