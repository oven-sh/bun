import { grin } from "./faces.ts";
const extra = { "\u{1F600}": "smile" };
const all = { ...grin, ...extra };
console.log(Object.keys(all).length, all["\u{1F600}"]);
