import * as Self from "./lamp.ts";
export default 7;
export function unused(text: string) { return eval(text); }
const self: any = Self;
const seen = [String(self.__esModule)];
for (const value of [true, false, 1, 0]) { self.__esModule = value; seen.push(String(self.__esModule)); }
console.log(seen.join());
