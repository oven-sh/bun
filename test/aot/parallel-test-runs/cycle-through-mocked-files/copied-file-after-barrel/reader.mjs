import { get } from "./barrel.mjs";
export const read = () => typeof get + " " + get();
