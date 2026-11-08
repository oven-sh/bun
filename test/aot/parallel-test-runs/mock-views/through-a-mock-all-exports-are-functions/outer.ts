import { readV } from "./inner";
export const outer = () => "real outer " + readV();
