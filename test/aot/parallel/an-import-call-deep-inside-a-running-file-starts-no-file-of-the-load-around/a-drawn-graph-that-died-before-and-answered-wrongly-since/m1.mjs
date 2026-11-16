import { t3 } from "./m3.mjs";
const later1 = () => import("./m6.cjs");
export const t1 = "m1(" + [t3, typeof later1].join() + ")";
