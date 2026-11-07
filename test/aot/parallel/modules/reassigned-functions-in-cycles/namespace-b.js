import * as ns from "./namespace-a.js";
export const seen = ns.h() + typeof ns.setH + Object.keys(ns).join() + ("h" in ns);
ns.setH(7);
