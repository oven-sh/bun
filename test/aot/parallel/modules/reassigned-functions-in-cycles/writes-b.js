import { a, b, c, d, e, f, write } from "./writes-a.js";
const before = [a, b, c, d, e, f].map(x => x()).join("");
write();
export const seen = before + [a, b, typeof c, d, e, f].join();
