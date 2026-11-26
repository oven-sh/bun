import { get } from "./api.mjs";
const kind = typeof get;
export const load = () => kind + " " + get();
