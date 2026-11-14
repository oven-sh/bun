import * as self from "./x";
console.log("SAID body");
export const f = () => Object.keys(self).join();
export const own = () => self.mark;
export const mark = "real";
